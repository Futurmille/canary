import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import {
  CanaryGuard,
  CanaryExperiment,
  CanaryManager,
  Variant,
} from '@futurmille/canary';

/**
 * Product controller demonstrating canary releases on specific endpoints.
 *
 * Key pattern:
 *   @UseGuards(CanaryGuard)        ← resolved from DI, configured in CanaryModule
 *   @CanaryExperiment('exp-name')  ← which experiment to evaluate
 *
 * The guard:
 * 1. Reads the experiment name from @CanaryExperiment metadata
 * 2. Extracts the user using getUserFromRequest (set in CanaryModule.forRoot)
 * 3. Resolves the variant via CanaryManager (sticky sessions)
 * 4. Attaches the variant to req.canaryVariant
 */
@Controller('products')
export class ProductsController {
  constructor(private readonly canaryManager: CanaryManager) {}

  /**
   * GET /products/:id
   *
   * The CanaryGuard runs before this handler:
   * - Resolves the variant for 'product-page-v2'
   * - Attaches it to req.canaryVariant
   * - Always allows through (denyStable defaults to false)
   */
  @UseGuards(CanaryGuard)
  @CanaryExperiment('product-page-v2')
  @Get(':id')
  async getProduct(@Param('id') id: string, @Req() req: any) {
    const variant: Variant = req.canaryVariant;

    // Track that the user actually SAW this variant
    const userId = req.headers['x-user-id'];
    if (userId) {
      await this.canaryManager.recordExposure(
        { id: userId },
        'product-page-v2',
      );
    }

    if (variant === 'canary') {
      return {
        id,
        name: 'Premium Widget',
        price: 29.99,
        variant: 'canary',
        // ── New canary features ──
        reviews: { average: 4.5, count: 128 },
        relatedProducts: ['widget-2', 'widget-3'],
        aiSummary: 'Customers love this widget for its durability.',
      };
    }

    return {
      id,
      name: 'Premium Widget',
      price: 29.99,
      variant: 'stable',
    };
  }

  /**
   * GET /products/:id/reviews
   *
   * Same experiment, different endpoint — the user gets the same variant
   * due to sticky sessions.
   */
  @UseGuards(CanaryGuard)
  @CanaryExperiment('product-page-v2')
  @Get(':id/reviews')
  getReviews(@Param('id') id: string, @Req() req: any) {
    const variant: Variant = req.canaryVariant;

    if (variant === 'canary') {
      return {
        productId: id,
        reviews: [
          { user: 'Alice', rating: 5, text: 'Best widget ever!', sentiment: 'positive' },
          { user: 'Bob', rating: 4, text: 'Good quality', sentiment: 'positive' },
        ],
        aiInsight: '92% of reviewers recommend this product.',
      };
    }

    return {
      productId: id,
      reviews: [
        { user: 'Alice', rating: 5, text: 'Best widget ever!' },
        { user: 'Bob', rating: 4, text: 'Good quality' },
      ],
    };
  }

  /**
   * GET /products/plain/:id
   *
   * No @CanaryExperiment decorator → CanaryGuard allows through
   * without resolving any variant. Regular endpoint.
   */
  @UseGuards(CanaryGuard)
  @Get('plain/:id')
  getPlainProduct(@Param('id') id: string) {
    return { id, name: 'Plain Widget', price: 9.99 };
  }
}
