// How the messages of the library name places: the dates, codes or shares at places counted from
// 1 among those typed, so that a message points to what is wrong without repeating it. A small
// helper that the parts share; it needs nothing from the host.

/** Places in words: "2", "1 and 2", "1, 2 and 3"; none for no place. */
export function placesInWords(places: readonly number[]): string {
  return places.length < 2
    ? places.join("")
    : `${places.slice(0, -1).join(", ")} and ${places.at(-1)}`;
}
