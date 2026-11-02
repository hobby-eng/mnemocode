//! Colours of the cards (MnemoCode TS 0.1.0's `export/color-math.ts`, `business-tint.ts` and
//! `card-palette.ts`): the conversions the artwork recolours by, how the business designs tint a
//! photograph with a card's colour, and the colours of cards that print codes, each distinct code
//! with its own, chosen as far as possible from the colours before it.

use std::fmt;
use std::sync::OnceLock;

use mnemocode::forms::colors::rgb_reference_digits;
use mnemocode::refusal::Refusal;

/// Rec. 709 luma weights of red, green and blue.
const REC709_LUMA: [f64; 3] = [0.2126, 0.7152, 0.0722];
/// The candidate colours: a hue every step, each with these saturations and values.
const HUE_STEP_DEGREES: u32 = 3;
const DEGREES: u32 = 360;
const CANDIDATE_SATURATIONS: [f64; 3] = [0.45, 0.72, 0.95];
const CANDIDATE_VALUES: [f64; 3] = [0.5, 0.75, 1.0];
/// Distances are compared in whole millionths of OKLab units, which never depend on the last bit
/// of a cube root or a power.
const DISTANCE_STEPS: f64 = 1_000_000.0;
/// The share of the artwork's own brightness that every reference keeps.
const BRIGHTNESS_FLOOR: f64 = 0.35;
/// A pixel less saturated than this, or darker than the value below it, keeps its colour.
const NEUTRAL_PIXEL_SATURATION: f64 = 0.2;
const NEUTRAL_PIXEL_VALUE: f64 = 0.08;
/// Below this saturation a reference counts as grey: the artwork turns grey and darker.
const GREY_REFERENCE_SATURATION: f64 = 0.08;
/// The factor of the value of a grey reference's artwork.
const GREY_VALUE: f64 = 0.6;
/// The saturation and value of a typical coloured pixel of the photographs.
const TYPICAL_SATURATION: f64 = 0.9;
const TYPICAL_VALUE: f64 = 0.85;

/// Hue, saturation and value, each from 0 to 1.
pub type Hsv = (f64, f64, f64);

/// RGB channels from 0 to 1 as hue, saturation and value, each from 0 to 1.
#[must_use]
pub fn hsv(red: f64, green: f64, blue: f64) -> Hsv {
    let max = red.max(green).max(blue);
    let min = red.min(green).min(blue);
    let range = max - min;
    let hue = if range == 0.0 {
        0.0
    } else if max == red {
        ((green - blue) / range + 6.0) % 6.0
    } else if max == green {
        (blue - red) / range + 2.0
    } else {
        (red - green) / range + 4.0
    };
    (hue / 6.0, if max == 0.0 { 0.0 } else { range / max }, max)
}

/// The eight-bit channel `byte` as a channel from 0 to 1.
#[must_use]
pub fn channel_of_byte(byte: u8) -> f64 {
    f64::from(byte) / 255.0
}

/// The red, green and blue bytes of a colour written #RRGGBB or RRGGBB, in either case.
pub fn rgb_bytes(color: &str) -> Result<[u8; 3], mnemocode::forms::colors::ColorsError> {
    let digits = rgb_reference_digits(color)?;
    let byte = |at: usize| u8::from_str_radix(&digits[at..at + 2], 16).unwrap_or(0);
    Ok([byte(0), byte(2), byte(4)])
}

/// The same channels from 0 to 1.
pub fn rgb_channels(color: &str) -> Result<[f64; 3], mnemocode::forms::colors::ColorsError> {
    Ok(rgb_bytes(color)?.map(channel_of_byte))
}

/// Red, green and blue channels, each clamped to 0 to 1, as six upper-case hexadecimal digits
/// without "#".
#[must_use]
pub fn channels_hex(channels: [f64; 3]) -> String {
    channels
        .map(|channel| format!("{:02X}", to_byte(channel.clamp(0.0, 1.0))))
        .concat()
}

/// A channel from 0 to 1 as the nearest eight-bit value.
fn to_byte(channel: f64) -> u8 {
    // Rounded as JavaScript's Math.round rounds: a half goes up.
    (channel * 255.0 + 0.5).floor() as u8
}

/// The Rec. 709 luma of a colour's bytes divided by its brightest channel (at least 1): how light
/// its hue is whatever its own brightness.
pub fn peak_relative_luma(color: &str) -> Result<f64, mnemocode::forms::colors::ColorsError> {
    let channels = rgb_bytes(color)?.map(f64::from);
    let peak = channels[0].max(channels[1]).max(channels[2]).max(1.0);
    Ok(
        (REC709_LUMA[0] * channels[0]
            + REC709_LUMA[1] * channels[1]
            + REC709_LUMA[2] * channels[2])
            / peak,
    )
}

/// Hue, saturation and value as rounded eight-bit red, green and blue, the inverse of [`hsv`].
#[must_use]
pub fn rgb_of_hsv((hue, saturation, value): Hsv) -> [u8; 3] {
    let sector = hue * 6.0;
    let chroma = value * saturation;
    let second = chroma * (1.0 - ((sector % 2.0) - 1.0).abs());
    let lift = value - chroma;
    let [red, green, blue] = if sector < 1.0 {
        [chroma, second, 0.0]
    } else if sector < 2.0 {
        [second, chroma, 0.0]
    } else if sector < 3.0 {
        [0.0, chroma, second]
    } else if sector < 4.0 {
        [0.0, second, chroma]
    } else if sector < 5.0 {
        [second, 0.0, chroma]
    } else {
        [chroma, 0.0, second]
    };
    [
        to_byte(red + lift),
        to_byte(green + lift),
        to_byte(blue + lift),
    ]
}

/// An sRGB channel from 0 to 1 as linear light (IEC 61966-2-1).
#[must_use]
pub fn linear_channel(channel: f64) -> f64 {
    if channel <= 0.04045 {
        channel / 12.92
    } else {
        libm::pow((channel + 0.055) / 1.055, 2.4)
    }
}

/// OKLab of sRGB channels from 0 to 1 (Björn Ottosson, 2020).
pub(crate) fn oklab(red: f64, green: f64, blue: f64) -> [f64; 3] {
    let (r, g, b) = (
        linear_channel(red),
        linear_channel(green),
        linear_channel(blue),
    );
    let l = libm::cbrt(0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * b);
    let m = libm::cbrt(0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * b);
    let s = libm::cbrt(0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * b);
    [
        0.210_454_255_3 * l + 0.793_617_785 * m - 0.004_072_046_8 * s,
        1.977_998_495_1 * l - 2.428_592_205 * m + 0.450_593_709_9 * s,
        0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766 * s,
    ]
}

/// How strongly a design's coloured parts take the reference's colour.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BusinessTint {
    /// The colour itself.
    Vivid,
    /// A quieter colour, near the grey of the design.
    Muted,
}

impl BusinessTint {
    /// The saturation that coloured parts take, from the reference's.
    fn saturation(self, target: f64) -> f64 {
        match self {
            Self::Vivid => target.max(0.4),
            Self::Muted => (target * 0.8).clamp(0.3, 0.75),
        }
    }

    /// The factor of their value.
    const fn value(self) -> f64 {
        match self {
            Self::Vivid => 1.0,
            Self::Muted => 0.86,
        }
    }
}

/// The factor of the artwork's brightness for the reference `hex`: the floor for black, 1 for a
/// colour with a full channel.
pub fn artwork_brightness(hex: &str) -> Result<f64, mnemocode::forms::colors::ColorsError> {
    let channels = rgb_channels(hex)?;
    let peak = channels[0].max(channels[1]).max(channels[2]);
    Ok(BRIGHTNESS_FLOOR + (1.0 - BRIGHTNESS_FLOOR) * peak)
}

/// The tint of one reference colour: settled once for a card, then applied to each pixel.
#[derive(Clone, Copy, Debug)]
pub struct ReferenceTint {
    hue: f64,
    saturation: f64,
    brightness: f64,
    grey: bool,
}

impl ReferenceTint {
    /// The tint of `hex`, a #RRGGBB or RRGGBB colour.
    pub fn new(hex: &str) -> Result<Self, mnemocode::forms::colors::ColorsError> {
        let [red, green, blue] = rgb_bytes(hex)?.map(f64::from);
        let (hue, saturation, _) = hsv(red, green, blue);
        Ok(Self {
            hue,
            saturation,
            brightness: artwork_brightness(hex)?,
            grey: saturation < GREY_REFERENCE_SATURATION,
        })
    }

    /// Whether the pixel keeps its own colour: neutral parts of the photograph.
    #[must_use]
    pub fn keeps((_, saturation, value): Hsv) -> bool {
        saturation < NEUTRAL_PIXEL_SATURATION || value < NEUTRAL_PIXEL_VALUE
    }

    /// The colour that a coloured pixel of a design takes: its hue turned from the design's origin
    /// to the reference's, its saturation and value scaled by the design's tint and the brightness.
    #[must_use]
    pub fn pixel(&self, (hue, saturation, value): Hsv, tint: BusinessTint, hue_origin: f64) -> Hsv {
        let turned = (((hue + self.hue - hue_origin) % 1.0) + 1.0) % 1.0;
        let tinted = if self.grey {
            0.0
        } else {
            saturation * tint.saturation(self.saturation)
        };
        let scale = if self.grey { GREY_VALUE } else { tint.value() };
        (turned, tinted, value * scale * self.brightness)
    }

    /// How a typical coloured pixel of a design with `tint` looks with this reference.
    #[must_use]
    pub fn typical(&self, tint: BusinessTint) -> Hsv {
        self.pixel(
            (self.hue, TYPICAL_SATURATION, TYPICAL_VALUE),
            tint,
            self.hue,
        )
    }
}

/// More distinct codes than the order has colours.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TooManyColours(usize);

impl fmt::Display for TooManyColours {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Cards that print codes have at most {} colours.", self.0)
    }
}

impl std::error::Error for TooManyColours {}

impl Refusal for TooManyColours {
    fn code(&self) -> &'static str {
        "export.card-palette.cards-print-codes-at-most-colours"
    }
}

/// One candidate colour, and how each design shows it, in OKLab.
struct Candidate {
    hex: String,
    views: [[f64; 3]; 3],
}

/// OKLab of eight-bit channels.
fn lab_of_bytes(bytes: [u8; 3]) -> [f64; 3] {
    let [red, green, blue] = bytes.map(channel_of_byte);
    oklab(red, green, blue)
}

/// The colour as the designs show it: in full, on vivid and on muted business cards.
fn views_of(bytes: [u8; 3]) -> [[f64; 3]; 3] {
    let hex = hex_of(bytes);
    let [red, green, blue] = bytes.map(channel_of_byte);
    let tint = ReferenceTint::new(&hex).ok();
    let view = |kind| {
        tint.map_or([0.0; 3], |tint| {
            lab_of_bytes(rgb_of_hsv(tint.typical(kind)))
        })
    };
    [
        oklab(red, green, blue),
        view(BusinessTint::Vivid),
        view(BusinessTint::Muted),
    ]
}

/// `bytes` written #RRGGBB.
fn hex_of(bytes: [u8; 3]) -> String {
    format!("#{:02X}{:02X}{:02X}", bytes[0], bytes[1], bytes[2])
}

/// Every candidate, in order of hue, then saturation, then value.
fn candidates() -> Vec<Candidate> {
    let mut all = Vec::new();
    for degrees in (0..DEGREES).step_by(HUE_STEP_DEGREES as usize) {
        for saturation in CANDIDATE_SATURATIONS {
            for value in CANDIDATE_VALUES {
                let hue = f64::from(degrees) / f64::from(DEGREES);
                let bytes = rgb_of_hsv((hue, saturation, value));
                all.push(Candidate {
                    hex: hex_of(bytes),
                    views: views_of(bytes),
                });
            }
        }
    }
    all
}

/// How far apart two candidates look, in millionths: their distance in the view where they are
/// closest.
fn distance(left: &[[f64; 3]; 3], right: &[[f64; 3]; 3]) -> u64 {
    left.iter()
        .zip(right)
        .map(|(view, other)| {
            let squares: f64 = view.iter().zip(other).map(|(a, b)| (a - b) * (a - b)).sum();
            (libm::sqrt(squares) * DISTANCE_STEPS + 0.5).floor() as u64
        })
        .min()
        .unwrap_or(0)
}

/// The colours in the order a set takes them: the middle candidate first, then each time the one
/// farthest from all before it, the first in the candidates' order on a tie. Each set takes the
/// first colours of this one order, so that a set of more codes keeps the colours of a smaller one.
fn farthest_colours() -> &'static [String] {
    static ORDER: OnceLock<Vec<String>> = OnceLock::new();
    ORDER.get_or_init(|| {
        let all = candidates();
        let mut nearest = vec![u64::MAX; all.len()];
        let mut order = Vec::with_capacity(all.len());
        for taken in 0..all.len() {
            let next = if taken == 0 {
                all.len() / 2
            } else {
                let mut best = 0;
                for index in 1..all.len() {
                    if nearest[index] > nearest[best] {
                        best = index;
                    }
                }
                best
            };
            let chosen = &all[next];
            order.push(chosen.hex.clone());
            for (place, candidate) in all.iter().enumerate() {
                nearest[place] = nearest[place].min(distance(&candidate.views, &chosen.views));
            }
        }
        order
    })
}

/// The colour of the card of each code of `codes`, in their order: the distinct codes take the
/// colours of the one order in the order in which they first appear, and every card of one code has
/// its colour. The colours carry nothing of the codes.
pub fn code_colors<S: AsRef<str>>(codes: &[S]) -> Result<Vec<String>, TooManyColours> {
    let colours = farthest_colours();
    let mut distinct: Vec<&str> = Vec::new();
    let mut result = Vec::with_capacity(codes.len());
    for code in codes {
        let code = code.as_ref();
        let rank = match distinct.iter().position(|known| *known == code) {
            Some(rank) => rank,
            None => {
                distinct.push(code);
                distinct.len() - 1
            }
        };
        let colour = colours.get(rank).ok_or(TooManyColours(colours.len()))?;
        result.push(colour.clone());
    }
    Ok(result)
}

/// The smallest distance, in millionths of OKLab units, between two of `colours` in any view.
pub fn closest_pair<S: AsRef<str>>(
    colours: &[S],
) -> Result<u64, mnemocode::forms::colors::ColorsError> {
    let looks = colours
        .iter()
        .map(|hex| rgb_bytes(hex.as_ref()).map(views_of))
        .collect::<Result<Vec<_>, _>>()?;
    let mut closest = u64::MAX;
    for (left, one) in looks.iter().enumerate() {
        for other in &looks[left + 1..] {
            closest = closest.min(distance(one, other));
        }
    }
    Ok(closest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hsv_and_back_give_the_bytes() {
        let (hue, saturation, value) = hsv(0.2, 0.4, 0.8);
        assert_eq!(rgb_of_hsv((hue, saturation, value)), [51, 102, 204]);
    }

    #[test]
    fn each_distinct_code_takes_its_own_colour() {
        let colours = code_colors(&["a", "b", "a"]).unwrap();
        assert_eq!(colours[0], colours[2]);
        assert_ne!(colours[0], colours[1]);
    }
}
