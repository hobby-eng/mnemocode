import { describe, expect, it } from 'vitest';
import { createCardSession } from '../src/cards.js';

describe('card session', () => {
  it('gives the same invented details for every export of one session', () => {
    const session = createCardSession();
    const first = session.settingsFor('business-it');
    for (let attempt = 0; attempt < 20; attempt += 1)
      expect(session.settingsFor('business-it')).toEqual(first);
    // The studio and the person stay; only the employer follows the sector of the design.
    const other = session.settingsFor('business-architect');
    expect(other.presentation).toEqual(first.presentation);
    expect(other.profile.name).toBe(first.profile.name);
    expect(session.settingsFor('business-architect')).toEqual(other);
    expect(session.settingsFor('material-tile')).toEqual(session.settingsFor('material-tile'));
  });

  it('starts again with a new session', () => {
    const seen = new Set<string>();
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const { profile, presentation } = createCardSession().settingsFor('business-it');
      seen.add(`${profile.name}|${profile.company}|${presentation.studioName}`);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('prints what the user supplies and keeps the rest', () => {
    const session = createCardSession();
    const invented = session.settingsFor('business-it');
    const own = session.settingsFor(
      'business-it',
      { name: 'John Smith', company: 'Example Systems' },
      { studioName: 'AURORA STUDIO' },
    );
    expect(own.profile.name).toBe('John Smith');
    expect(own.profile.company).toBe('Example Systems');
    expect(own.profile.email).toBe('contact@examplesystems.com');
    expect(own.profile.website).toBe('examplesystems.com');
    expect(own.profile.role).toBe(invented.profile.role);
    expect(own.presentation.studioName).toBe('AURORA STUDIO');
    expect(own.presentation.slogan).toBe(invented.presentation.slogan);
    // Supplying details does not disturb what the session remembers.
    expect(session.settingsFor('business-it')).toEqual(invented);
    expect(() => session.settingsFor('business-it', { name: '1234' })).toThrow('Latin letters');
  });
});
