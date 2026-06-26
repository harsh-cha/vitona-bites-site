const fs = require('fs');
const path = require('path');

function loadProducts() {
  const candidates = [
    path.join(__dirname, '..', '..', 'products.json'),
    path.join(__dirname, 'products.json'),
    path.join(process.cwd(), 'products.json')
  ];
  for (const candidate of candidates) {
    try {
      const raw = fs.readFileSync(candidate, 'utf8');
      const list = JSON.parse(raw);
      const map = {};
      for (const p of list) {
        map[p.id] = { p500: p.p500, p1kg: p.p1kg };
      }
      return map;
    } catch (err) {
      continue;
    }
  }
  throw new Error('products.json not found in any expected location');
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let cart;
  try {
    const body = JSON.parse(event.body);
    cart = body.cart;
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  if (!Array.isArray(cart) || cart.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Cart is empty' }) };
  }

  let PRODUCTS;
  try {
    PRODUCTS = loadProducts();
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not load product catalog' }) };
  }

  let subtotal = 0;
  for (const item of cart) {
    const product = PRODUCTS[item.id];
    if (!product) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Unknown product: ' + item.id }) };
    }
    if (item.size !== '500g' && item.size !== '1kg') {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid size for ' + item.id }) };
    }
    const qty = Number(item.qty);
    if (!Number.isInteger(qty) || qty <= 0 || qty > 50) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid quantity for ' + item.id }) };
    }
    const unitPrice = item.size === '500g' ? product.p500 : product.p1kg;
    subtotal += unitPrice * qty;
  }

  const total = subtotal;

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Payment gateway not configured' }) };
  }

  const auth = Buffer.from(keyId + ':' + keySecret).toString('base64');

  try {
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + auth
      },
      body: JSON.stringify({
        amount: total * 100,
        currency: 'INR',
        receipt: 'vitona_' + Date.now()
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Razorpay order creation failed', details: data }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        orderId: data.id,
        amount: data.amount,
        currency: data.currency,
        keyId: keyId
      })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error creating order' }) };
  }
};
