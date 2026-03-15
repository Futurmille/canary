/**
 * ══════════════════════════════════════════════════════════════
 * PHASE 1: CURRENT STATE — NO CANARY
 * ══════════════════════════════════════════════════════════════
 *
 * MyStore.com has a product endpoint. All users see exactly
 * the same response.
 *
 * Laura (enterprise) → { name: "Laptop Pro", price: 1299 }
 * Pedro (free)       → { name: "Laptop Pro", price: 1299 }
 *
 * The team wants to add AI-powered reviews, but does NOT want
 * to ship it to everyone at once. They want Laura to test it first.
 */

// ── This is what the controller looks like BEFORE canary ─────

/*
import { Controller, Get, Param } from '@nestjs/common';

@Controller('products')
export class ProductsController {

  // One endpoint, one response for EVERYONE
  @Get(':id')
  getProduct(@Param('id') id: string) {
    return {
      id,
      name: 'Laptop Pro',
      price: 1299,
      currency: 'EUR',
      stock: 42,
    };
  }
}
*/

// ── Simulation: let's verify both users see the same thing ───

interface Product {
  id: string;
  name: string;
  price: number;
  currency: string;
  stock: number;
}

function getProduct(productId: string): Product {
  return {
    id: productId,
    name: 'Laptop Pro',
    price: 1299,
    currency: 'EUR',
    stock: 42,
  };
}

// Laura requests the product
const lauraResponse = getProduct('laptop-1');
console.log('Laura sees:', JSON.stringify(lauraResponse, null, 2));

// Pedro requests the product
const pedroResponse = getProduct('laptop-1');
console.log('Pedro sees:', JSON.stringify(pedroResponse, null, 2));

// Both see EXACTLY the same thing
console.log('\nSame response?', JSON.stringify(lauraResponse) === JSON.stringify(pedroResponse));
// → true

console.log('\n───────────────────────────────────────');
console.log('Problem: if we ship v2 with AI reviews,');
console.log('ALL users see it at the same time.');
console.log('If it has a bug, it affects EVERYONE.');
console.log('Solution: @futurmille/canary → see 02-with-canary.ts');

export {};
