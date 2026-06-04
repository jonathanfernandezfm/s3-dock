import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY is not set");
}

const globalForStripe = globalThis as unknown as {
  stripe: Stripe | undefined;
};

export const stripe =
  globalForStripe.stripe ?? new Stripe(process.env.STRIPE_SECRET_KEY);

if (process.env.NODE_ENV !== "production") globalForStripe.stripe = stripe;
