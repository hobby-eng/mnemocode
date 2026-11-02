//! The phrases of every combination of forgotten dates (MnemoCode TS 0.1.0's
//! `core/date-recovery.ts`, CAP-RECOVERY-DATE-CANDIDATES): every combination that the date patterns
//! allow, with the known dates, once for each shift.

use std::rc::Rc;

use super::DateSearchError;
use crate::bip39::phrase::Phrase;
use crate::bip39::sizes::DICTIONARY_SIZE;
use crate::dates::answer::DatesAnswer;
use crate::dates::{
    Date, DatePattern, Dates, days_in_month, derive_shifts, maximum_dates, same_key_predecessors,
};
use crate::modes::Mode;
use crate::modes::seedshift::Indexes;

/// The largest year of a date.
const LAST_YEAR: u16 = 9999;
/// The days of the longest month: a shift modulo more than this tells every day apart.
const LONGEST_MONTH: u32 = 31;

/// A phrase that one combination of dates gives.
#[derive(Debug)]
pub struct DateCandidate {
    /// The dates that were guessed, sorted: what the search found.
    pub dates: Dates,
    /// Every date that decodes the codes to `phrase`, the known ones too, sorted.
    pub all_dates: Dates,
    /// The seed phrase that the codes give with these dates, its BIP39 checksum valid.
    pub phrase: Phrase,
}

/// Every combination of the dates of some patterns, the dates of one key in ascending order only,
/// keeping its place.
#[derive(Debug)]
struct DateWalk {
    lists: Vec<Vec<Date>>,
    predecessors: Vec<Option<usize>>,
    positions: Vec<usize>,
    chosen: Vec<Date>,
    started: bool,
}

impl DateWalk {
    fn new(patterns: &[DatePattern]) -> Self {
        let lists: Vec<Vec<Date>> = patterns
            .iter()
            .map(|pattern| pattern.dates().collect())
            .collect();
        let chosen = lists
            .iter()
            .filter_map(|list| list.first().copied())
            .collect();
        Self {
            predecessors: same_key_predecessors(patterns),
            positions: vec![0; lists.len()],
            lists,
            chosen,
            started: false,
        }
    }

    /// Puts the patterns from `place` on at their first dates: for a pattern with the key of an
    /// earlier one, the first not before that one's date.
    fn settle_from(&mut self, place: usize) {
        for index in place..self.lists.len() {
            let earlier = self.predecessors[index].map(|at| self.chosen[at]);
            let list = &self.lists[index];
            let first = earlier.map_or(0, |date| list.partition_point(|&other| other < date));
            self.positions[index] = first;
            self.chosen[index] = list[first];
        }
    }

    /// The next combination, kept here; none after the last.
    fn next_dates(&mut self) -> Option<&[Date]> {
        if !self.started {
            self.started = true;
            self.settle_from(0);
            return Some(&self.chosen);
        }
        for place in (0..self.lists.len()).rev() {
            if self.positions[place] + 1 < self.lists[place].len() {
                self.positions[place] += 1;
                self.chosen[place] = self.lists[place][self.positions[place]];
                self.settle_from(place + 1);
                return Some(&self.chosen);
            }
        }
        None
    }
}

/// A date with what tells it apart in the shifts: its year modulo 2,048, its month and its day.
type ShiftKey = (u16, u8, u8);

/// The shift key of `date`.
fn shift_key_of(date: Date) -> ShiftKey {
    (
        date.year() % DICTIONARY_SIZE as u16,
        date.month(),
        date.day(),
    )
}

/// What every other last date shares with the last date of a combination where the day of the last
/// date moves only the last word, and only in part.
#[derive(Clone, Copy, Debug)]
struct LastDayStands {
    year: u16,
    month: u8,
    day: u32,
}

/// A value that may stand in a pattern's place, with the shift key it takes up, or none for a last
/// date of another day.
#[derive(Clone, Copy, Debug)]
struct Stand {
    date: Date,
    key: Option<ShiftKey>,
}

/// Whether an earlier combination of the patterns gave the same effective shifts as a given one.
///
/// Two combinations give the same shifts only where their sorted dates agree, place by place, in
/// the year modulo 2,048, the month and the day, except for the day of the last date where the mode
/// adds it to the last word in part. So every date of an earlier combination has the shift key of
/// one of the guessed dates, or is such a last date, and the patterns allow only a few: those are
/// tried in the order the search goes, up to the combination itself. Worked out from the
/// combination, never kept: a search of two billion combinations needs no memory for it.
#[derive(Debug)]
struct EarlierShifts {
    known: Vec<Date>,
    patterns: Rc<[DatePattern]>,
    /// For each pattern, the earlier one with the same key, whose date it never precedes.
    same_as: Vec<Option<usize>>,
    mode: Mode,
    word_count: usize,
    last_modulus: u32,
}

/// One walk of [`EarlierShifts::search`], which keeps what its choices took up.
struct Walk<'a> {
    guessed: &'a [Date],
    shifts: Vec<u32>,
    stands: Vec<Vec<Stand>>,
    remaining: Vec<(ShiftKey, usize)>,
    chosen: Vec<Date>,
}

impl EarlierShifts {
    /// The effective shifts of a combination.
    fn shifts_of(&self, guessed: &[Date]) -> Result<Vec<u32>, DateSearchError> {
        let all: Vec<Date> = self.known.iter().chain(guessed).copied().collect();
        Ok(self
            .mode
            .effective_shifts(&derive_shifts(&all, self.word_count)?)?)
    }

    /// Where the day of the last date moves only the last word, and only in part: the year, the
    /// month and the remainder of the day that every other last date must share with it.
    fn last_day_stands(&self, all: &mut [Date]) -> Option<LastDayStands> {
        if self.last_modulus > LONGEST_MONTH {
            return None;
        }
        // With fewer dates the shifts repeat, and the day of the last date moves other words too.
        if all.len() != maximum_dates(self.word_count) {
            return None;
        }
        all.sort_unstable();
        let last = *all.last()?;
        Some(LastDayStands {
            year: last.year() % DICTIONARY_SIZE as u16,
            month: last.month(),
            day: u32::from(last.day()) % self.last_modulus,
        })
    }

    /// The dates that may stand in the place of pattern `index`, earliest first: those of each
    /// shift key of `keyed`, a date of the key for each, and those of `last_day`.
    fn stands_for(
        &self,
        index: usize,
        keyed: &[(ShiftKey, Date)],
        last_day: Option<LastDayStands>,
    ) -> Vec<Stand> {
        let pattern = &self.patterns[index];
        let mut stands = Vec::new();
        let mut add = |year: u16, month: u8, day: u8, key: Option<ShiftKey>| {
            if !pattern.allows(year, month, day)
                || days_in_month(year, month).is_ok_and(|last| day > last)
            {
                return;
            }
            if let Ok(date) = Date::new(year.into(), month.into(), day.into()) {
                stands.push(Stand { date, key });
            }
        };
        for &(key, date) in keyed {
            // Every year with the key's remainder modulo 2,048, from the remainder itself up.
            let mut year = date.year() % DICTIONARY_SIZE as u16;
            while year <= LAST_YEAR {
                add(year, date.month(), date.day(), Some(key));
                year += DICTIONARY_SIZE as u16;
            }
        }
        if let Some(last) = last_day {
            let mut year = last.year;
            while year <= LAST_YEAR {
                for &day in pattern.days() {
                    if u32::from(day) % self.last_modulus == last.day {
                        add(year, last.month, day, None);
                    }
                }
                year += DICTIONARY_SIZE as u16;
            }
        }
        stands.sort_by_key(|stand| stand.date);
        stands
    }

    /// Whether a combination before `guessed` gave its effective shifts, and so its phrases.
    fn gave_shifts_of(&self, guessed: &[Date]) -> Result<bool, DateSearchError> {
        let mut remaining: Vec<(ShiftKey, usize)> = Vec::new();
        // A date of each shift key, in the order the keys came: where the stands of a key start.
        let mut keyed: Vec<(ShiftKey, Date)> = Vec::new();
        for &date in guessed {
            let key = shift_key_of(date);
            match remaining.iter().position(|(known, _)| *known == key) {
                Some(place) => {
                    remaining[place].1 += 1;
                    keyed[place].1 = date;
                }
                None => {
                    remaining.push((key, 1));
                    keyed.push((key, date));
                }
            }
        }
        let mut all: Vec<Date> = self.known.iter().chain(guessed).copied().collect();
        let last_day = self.last_day_stands(&mut all);
        let stands = (0..self.patterns.len())
            .map(|index| self.stands_for(index, &keyed, last_day))
            .collect();
        let mut walk = Walk {
            guessed,
            shifts: self.shifts_of(guessed)?,
            stands,
            remaining,
            chosen: Vec::new(),
        };
        self.search(&mut walk, false, false)
    }

    /// Tries the dates that may stand in each place from `chosen.len()` on, in the order of the
    /// search, while the combination is not yet later than `guessed`; true once one before it gives
    /// the same shifts. Each guessed date's shift key is taken up once, and one place at most may
    /// hold a last date of another day.
    fn search(
        &self,
        walk: &mut Walk<'_>,
        before: bool,
        last_day_used: bool,
    ) -> Result<bool, DateSearchError> {
        let index = walk.chosen.len();
        if index == walk.guessed.len() {
            return Ok(before && self.shifts_of(&walk.chosen)? == walk.shifts);
        }
        let same_as = self.same_as[index];
        for at in 0..walk.stands[index].len() {
            let stand = walk.stands[index][at];
            if same_as.is_some_and(|earlier| stand.date < walk.chosen[earlier]) {
                continue;
            }
            let order = if before {
                std::cmp::Ordering::Less
            } else {
                stand.date.cmp(&walk.guessed[index])
            };
            // The stands are sorted, so every later one is later than the combination too.
            if order.is_gt() {
                break;
            }
            let slot = stand
                .key
                .and_then(|key| walk.remaining.iter().position(|(known, _)| *known == key));
            let free = match stand.key {
                None => !last_day_used,
                Some(_) => slot.is_some_and(|slot| walk.remaining[slot].1 > 0),
            };
            if !free {
                continue;
            }
            if let Some(slot) = slot {
                walk.remaining[slot].1 -= 1;
            }
            walk.chosen.push(stand.date);
            let found = self.search(walk, order.is_lt(), last_day_used || stand.key.is_none())?;
            walk.chosen.pop();
            if let Some(slot) = slot {
                walk.remaining[slot].1 += 1;
            }
            if found {
                return Ok(true);
            }
        }
        Ok(false)
    }
}

/// The phrases of every combination of the forgotten dates with the known ones, in the order of the
/// patterns, keeping its place. A combination that shifts every word as an earlier one did gives
/// the same phrases, and none here: the same dates in another order, a year 2,048 years later,
/// since Seedshift adds the year to a word number modulo the 2,048 words, or a last date whose day
/// the mode adds to the last word only in part. So each shift is tried once, with the earliest
/// dates that give it.
#[derive(Debug)]
pub struct DateCandidates {
    indexes: Indexes,
    mode: Mode,
    walk: DateWalk,
    earlier: EarlierShifts,
}

impl DateCandidates {
    /// The candidates of `indexes` in `mode` with the dates of `dates`.
    pub(super) fn new(
        indexes: Indexes,
        dates: &DatesAnswer,
        mode: Mode,
    ) -> Result<Self, DateSearchError> {
        let word_count = indexes.as_slice().len();
        let patterns: Rc<[DatePattern]> = dates.patterns().iter().cloned().collect();
        let earlier = EarlierShifts {
            known: dates.known().iter().collect(),
            same_as: same_key_predecessors(&patterns),
            mode,
            word_count,
            last_modulus: mode.last_shift_modulus(word_count)?,
            patterns: Rc::clone(&patterns),
        };
        Ok(Self {
            indexes,
            mode,
            walk: DateWalk::new(&patterns),
            earlier,
        })
    }

    /// The phrases that are new with the next combination; none after the last.
    pub fn next_combination(&mut self) -> Result<Option<Vec<DateCandidate>>, DateSearchError> {
        let Some(guessed) = self.walk.next_dates() else {
            return Ok(None);
        };
        if self.earlier.gave_shifts_of(guessed)? {
            return Ok(Some(Vec::new()));
        }
        let mut sorted = guessed.to_vec();
        sorted.sort_unstable();
        let mut all: Vec<Date> = self.earlier.known.clone();
        all.extend_from_slice(&sorted);
        all.sort_unstable();
        let dates = Dates::new(&sorted);
        let all_dates = Dates::new(&all);
        let mut candidates = Vec::new();
        for result in self.mode.undo(&self.indexes, &all)? {
            if !result.checksum_valid {
                continue;
            }
            let recovered: Vec<usize> = result
                .recovered
                .as_slice()
                .iter()
                .map(|&index| usize::from(index))
                .collect();
            candidates.push(DateCandidate {
                dates: dates.clone(),
                all_dates: all_dates.clone(),
                phrase: Phrase::of_indexes(&recovered)?,
            });
        }
        Ok(Some(candidates))
    }
}
