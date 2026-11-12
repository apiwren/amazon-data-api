import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AmazonDataError, type AmazonData } from 'amazon-data-api';

const country = z.enum(['US','CA','MX','BR','GB','DE','FR','IT','ES','NL','SE','PL','BE','TR','AE','SA','EG','IN','JP','SG','AU','IE','ZA'])
  .optional().describe('Amazon marketplace as an ISO country code. GB is amazon.co.uk. Default US.');
const sort = z.enum(['relevance','price_asc','price_desc','reviews','newest','bestsellers']).optional();
const page = z.number().int().min(1).max(20).optional();
const sellerId = z.string().regex(/^[A-Za-z0-9]{10,16}$/).describe('Amazon seller ID, e.g. A2L77EE7U53NWQ (the seller= value in seller links).');
const brand = z.string().max(320).optional().describe('Only these brands, by name, comma-separated (e.g. Anker,Belkin).');
const filters = z.string().max(1100).optional().describe('Comma-separated values from a previous response\'s refinements (Prime, 4 stars and up, condition, deal type). They differ by marketplace.');
const asin = z.string().regex(/^[A-Za-z0-9]{10}$/).describe('10-character Amazon product ID (ASIN).');

async function run(fn: () => Promise<{ data: unknown }>) {
  try {
    return { content: [{ type: 'text' as const, text: JSON.stringify((await fn()).data) }] };
  } catch (e) {
    const text = e instanceof AmazonDataError ? `${e.code} (${e.status}): ${e.message}` : `error: ${e instanceof Error ? e.message : String(e)}`;
    return { isError: true, content: [{ type: 'text' as const, text }] };
  }
}

export function createServer(client: AmazonData): McpServer {
  const server = new McpServer({ name: 'amazon-data-api-mcp', version: '0.5.0' });
  server.registerTool('search_products', {
    description: 'Search products',
    inputSchema: {
      query: z.string().min(1).max(200).describe('Search keywords.'),
      country,
      page,
      sort,
      min_price: z.number().min(0).optional().describe("In the marketplace's currency."),
      max_price: z.number().min(0).optional(),
      category: z.string().optional().describe('Amazon search category alias (e.g. electronics) or numeric browse node ID (e.g. 172541).'),
      brand,
      seller_id: sellerId.optional().describe('Only products sold by this third-party seller.'),
      filters,
    },
  }, (p) => run(() => client.search(p)));
  server.registerTool('get_product', {
    description: 'Product details by ASIN',
    inputSchema: { asin, country },
  }, (p) => run(() => client.productDetails(p)));
  server.registerTool('get_reviews', {
    description: 'Ratings and review highlights',
    inputSchema: { asin, country },
  }, (p) => run(() => client.productReviews(p)));
  server.registerTool('get_best_sellers', {
    description: 'Best sellers and rankings',
    inputSchema: {
      category: z.string().describe("Category slug as in Amazon's best-seller URLs, optionally with a node ID, e.g. electronics."),
      type: z.enum(['bestsellers','new-releases','movers-and-shakers','most-wished-for','gift-ideas']).optional(),
      country,
      page: z.union([z.literal(1), z.literal(2)]).optional().describe('1 = ranks 1 to 50, 2 = ranks 51 to 100.'),
    },
  }, (p) => run(() => client.bestSellers(p)));
  server.registerTool('get_seller_products', {
    description: "Products listed by a third-party seller (the seller's storefront)",
    inputSchema: { seller_id: sellerId, country, page, sort },
  }, (p) => run(() => client.sellerProducts(p)));
  server.registerTool('lookup_product', {
    description: 'Find the Amazon product for a barcode: UPC, EAN, ISBN or GTIN',
    inputSchema: {
      identifier: z.string().min(8).max(20).describe('UPC (12 digits), EAN/GTIN (8, 13 or 14 digits) or ISBN-10/13. Hyphens and spaces are ignored.'),
      country,
    },
  }, (p) => run(() => client.productLookup(p)));
  server.registerTool('get_offers', {
    description: 'All seller offers for a product: price, condition, seller rating, FBA, Prime, delivery',
    inputSchema: {
      asin, country, page,
      condition: z.string().optional().describe('Comma-separated: new, used, used_like_new, used_very_good, used_good, used_acceptable.'),
      prime: z.boolean().optional().describe('true for Prime-eligible offers only.'),
    },
  }, (p) => run(() => client.productOffers(p)));
  server.registerTool('get_deals', {
    description: "Today's deals on the marketplace's deals page, with optional filters",
    inputSchema: {
      country,
      department: z.string().regex(/^\d{1,15}$/).optional().describe('A departments value from refinements in a previous response.'),
      brand: z.string().optional().describe('A brands value from refinements, e.g. 200611|Ring.'),
      price_range: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional().describe("Amazon's price bucket, 1 (lowest) to 5."),
      min_discount: z.number().int().min(1).max(99).optional().describe('At least this percent off.'),
      four_stars_and_up: z.boolean().optional(),
      prime_exclusive: z.boolean().optional(),
    },
  }, (p) => run(() => client.deals(p)));
  server.registerTool('get_seller_profile', {
    description: 'Seller profile: business name and address, rating, feedback counts and star breakdown',
    inputSchema: { seller_id: sellerId, country },
  }, (p) => run(() => client.sellerProfile(p)));
  server.registerTool('get_seller_reviews', {
    description: "A seller's buyer feedback, newest first: rating, comment, rater, date",
    inputSchema: {
      seller_id: sellerId,
      cursor: z.string().optional().describe('next_cursor from the previous call, for older feedback. Omit for the newest page.'),
      star_rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional().describe('Only feedback with this rating, last 12 months.'),
      country,
    },
  }, (p) => run(() => client.sellerReviews(p)));
  const handle = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/).describe('Influencer storefront name, as in amazon.com/shop/<handle>.');
  server.registerTool('get_influencer_profile', {
    description: "An Amazon influencer's storefront: name, bio, social links, trending products",
    inputSchema: { handle, country },
  }, (p) => run(() => client.influencerProfile(p)));
  server.registerTool('get_influencer_posts', {
    description: "An Amazon influencer's newest video posts, with the ASINs each one features",
    inputSchema: { handle, country },
  }, (p) => run(() => client.influencerPosts(p)));
  server.registerTool('get_influencer_list_products', {
    description: "The products in an Amazon influencer's list post (US): title, item count, first ~20 products",
    inputSchema: {
      handle,
      post_id: z.string().regex(/^(amzn1\.ideas\.)?[A-Za-z0-9]{8,20}$/).describe('List post ID, e.g. amzn1.ideas.382NVFBNK3GGQ.'),
      country,
    },
  }, (p) => run(() => client.influencerPostProducts(p)));
  server.registerTool('get_promotion', {
    description: 'An Amazon promotion by ID: title, schedule, how to claim, the seller running it',
    inputSchema: {
      promo_id: z.string().regex(/^[A-Za-z0-9]{8,20}$/).describe('The ID in an amazon.com/promotion/psp/<promo_id> link.'),
      country,
    },
  }, (p) => run(() => client.promoCodeDetails(p)));
  server.registerTool('get_categories', {
    description: 'Category tree: top-level categories, or the children of one category',
    inputSchema: {
      category: z.string().optional().describe('A path returned by a previous call (e.g. electronics or electronics/172541). Omit for the top level.'),
      country,
    },
  }, (p) => run(() => client.categories(p)));
  server.registerTool('search_autocomplete', {
    description: "Amazon's search-box suggestions for a partial query",
    inputSchema: { query: z.string().min(1).max(100), country },
  }, (p) => run(() => client.searchAutocomplete(p)));
  server.registerTool('get_category_products', {
    description: 'Browse the products in a category, without a search query',
    inputSchema: {
      category: z.string().describe('Search category alias (e.g. electronics) or numeric browse node ID (e.g. 172541).'),
      country,
      page,
      sort,
      brand,
      filters,
    },
  }, (p) => run(() => client.productsByCategory(p)));
  return server;
}
