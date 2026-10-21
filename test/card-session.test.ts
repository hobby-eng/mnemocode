import { describe, expect, it } from "vitest";
import { CardSession } from "../src/cards.js";
import type { UniformChoice } from "../src/export/platform.js";

const FIRST_CHOICE: UniformChoice = () => 0;
const REPEATED_EXPORTS = 20;

describe("card session", () => {
  it("gives the same invented details for every export of one session", () => {
    const session = new CardSession(FIRST_CHOICE);
    const first = session.settingsFor("business-it");
    for (let attempt = 0; attempt < REPEATED_EXPORTS; attempt += 1)
      expect(session.settingsFor("business-it")).toEqual(first);
    // The studio and the person stay; only the employer follows the sector of the design.
    const other = session.settingsFor("business-architect");
    expect(other.presentation).toEqual(first.presentation);
    expect(other.profile.name).toBe(first.profile.name);
    expect(session.settingsFor("business-architect")).toEqual(other);
    expect(session.settingsFor("material-tile")).toEqual(session.settingsFor("material-tile"));
  });

  it("uses fresh scripted host choices for a new session without changing an existing one", () => {
    let last = false;
    let choices = 0;
    const choose: UniformChoice = (upperExclusive) => {
      choices += 1;
      return last ? upperExclusive - 1 : 0;
    };
    const first = new CardSession(choose);
    const original = first.settingsFor("business-it");
    expect(original.profile).toMatchObject({
      name: "Alex Morgan",
      company: "Norvale Systems",
      role: "Software Engineer",
    });
    expect(original.presentation.studioName).toBe("Alder & Vale");
    last = true;
    expect(first.settingsFor("business-it")).toEqual(original);
    const before = choices;
    const fresh = new CardSession(choose).settingsFor("business-it");
    expect(choices).toBeGreaterThan(before);
    expect(fresh.profile).toMatchObject({
      name: "Amina Diallo",
      company: "Fenwick Networks",
      role: "Project Manager",
    });
    expect(fresh.presentation.studioName).toBe("Fallow & Reed");
    expect(first.settingsFor("business-it")).toEqual(original);
  });

  it("prints what the user supplies and keeps the rest", () => {
    const session = new CardSession(FIRST_CHOICE);
    const invented = session.settingsFor("business-it");
    const own = session.settingsFor(
      "business-it",
      { name: "John Smith", company: "Example Systems" },
      { studioName: "AURORA STUDIO" },
    );
    expect(own.profile.name).toBe("John Smith");
    expect(own.profile.company).toBe("Example Systems");
    expect(own.profile.email).toBe("contact@examplesystems.example");
    expect(own.profile.website).toBe("examplesystems.example");
    expect(own.profile.role).toBe(invented.profile.role);
    expect(own.presentation.studioName).toBe("AURORA STUDIO");
    expect(own.presentation.slogan).toBe(invented.presentation.slogan);
    // Supplying details does not disturb what the session remembers.
    expect(session.settingsFor("business-it")).toEqual(invented);
    expect(() => session.settingsFor("business-it", { name: "1234" })).toThrow("Latin letters");
  });
});
