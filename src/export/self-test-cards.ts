// What the self-tests of cards draw with and check: the details of the cards, all given so that
// nothing is chosen at random, and the size of an A6 page. The self-test of every design
// (cards-self-test.ts), of share cards (sskr-render-self-test.ts) and of the reader of card PDFs
// (card-drawing-self-test.ts) take them from here.

import type { CardPresentation, CardProfile } from "./card-settings.js";

/** Every field of a card given: one left out would be invented, with the platform's randomness. */
export const SELF_TEST_CARD_DETAILS: {
  readonly profile: Required<CardProfile>;
  readonly presentation: CardPresentation;
} = Object.freeze({
  profile: Object.freeze({
    name: "Alex Morgan",
    role: "Design Director",
    company: "VECTOR STUDIO",
    email: "alex@vector.example",
    phone: "+44 20 7946 0281",
    website: "vector.example",
    location: "London",
  }),
  presentation: Object.freeze({
    studioName: "VECTOR STUDIO",
    slogan: "Design with purpose.",
    subtitle: "Selected finishes",
    footer: "Crafted with care.",
    referenceLabel: "Ref.",
  }),
});

/** An A6 page in landscape is 148 mm wide; a PDF measures in points of 1/72 inch. */
export const A6_WIDTH_POINTS = (148 * 72) / 25.4;
/** And 105 mm high. */
export const A6_HEIGHT_POINTS = (105 * 72) / 25.4;
/** How far the width or the height of a drawn page may be from them. */
export const WIDTH_TOLERANCE_POINTS = 0.01;
