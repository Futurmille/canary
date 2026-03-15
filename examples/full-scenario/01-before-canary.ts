/**
 * ══════════════════════════════════════════════════════════════
 * FASE 1: EL ESTADO ACTUAL — SIN CANARY
 * ══════════════════════════════════════════════════════════════
 *
 * MiTienda.com tiene un endpoint de productos. Todos los usuarios
 * ven exactamente la misma respuesta.
 *
 * Laura (enterprise) → { name: "Laptop Pro", price: 1299 }
 * Pedro (free)       → { name: "Laptop Pro", price: 1299 }
 *
 * El equipo quiere añadir reseñas con IA, pero NO quiere
 * lanzarlo a todos de golpe. Primero quiere que Laura lo pruebe.
 */

// ── Así se ve el controller ANTES de canary ──────────────────

/*
import { Controller, Get, Param } from '@nestjs/common';

@Controller('products')
export class ProductsController {

  // Un solo endpoint, una sola respuesta para TODOS
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

// ── Simulación: probemos que ambos usuarios ven lo mismo ─────

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

// Laura pide el producto
const lauraResponse = getProduct('laptop-1');
console.log('Laura ve:', JSON.stringify(lauraResponse, null, 2));

// Pedro pide el producto
const pedroResponse = getProduct('laptop-1');
console.log('Pedro ve:', JSON.stringify(pedroResponse, null, 2));

// Ambos ven EXACTAMENTE lo mismo
console.log('\n¿Misma respuesta?', JSON.stringify(lauraResponse) === JSON.stringify(pedroResponse));
// → true

console.log('\n───────────────────────────────────────');
console.log('Problema: si lanzamos la v2 con reseñas IA,');
console.log('TODOS los usuarios la ven al mismo tiempo.');
console.log('Si tiene un bug, afecta a TODOS.');
console.log('Solución: @canary-node/core → ver 02-with-canary.ts');

export {};
