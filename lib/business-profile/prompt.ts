export const PROMPT_VERSION = 1;
export const PROFILE_PROMPT = `Using everything you know about my business from our conversations (and asking
me if something important is missing), write ONE Markdown document with exactly
these level-2 headings, in this order:

## Business overview
## Services and prices
## Ideal customer
## Customers to avoid
## Service area
## Proof and results
## Goals for the next 90 days
## Monthly budget for tools and ads
## Tone and voice
## What makes us different
## Business contact details

Rules: be specific (industries, sizes, cities, price ranges). Under "Ideal
customer" include signs that a business is ready to buy. Under "Business
contact details" give the business name, website, and the public mailing
address used for emails. Do not include passwords, API keys, card numbers,
or private client information. If you don't know something, write "unknown"
instead of guessing. Output only the Markdown.`;

