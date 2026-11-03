//! Colours as the eye compares them: sRGB bytes to linear light and to CIELAB (D65), and the
//! distance between two CIELAB colours (CIE76). The powers go through libm, so that a picture gives
//! the same pattern on every system and in the WebAssembly file.

/// A colour in CIELAB: lightness from 0 to 100, then the green-red and blue-yellow axes.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Lab {
    /// Lightness.
    pub l: f64,
    /// Green (negative) to red (positive).
    pub a: f64,
    /// Blue (negative) to yellow (positive).
    pub b: f64,
}

impl Lab {
    /// The squared CIE76 distance to `other`: comparisons need no square root.
    #[must_use]
    pub fn distance_squared(self, other: Self) -> f64 {
        let (dl, da, db) = (self.l - other.l, self.a - other.a, self.b - other.b);
        dl * dl + da * da + db * db
    }

    /// The CIE76 distance to `other`: about 2.3 is the least difference an eye sees.
    #[must_use]
    pub fn distance(self, other: Self) -> f64 {
        libm::sqrt(self.distance_squared(other))
    }

    /// This colour moved by `amount` times `other`, channel by channel.
    #[must_use]
    pub fn plus(self, other: Self, amount: f64) -> Self {
        Self {
            l: self.l + other.l * amount,
            a: self.a + other.a * amount,
            b: self.b + other.b * amount,
        }
    }

    /// The difference `self - other`, each channel kept within `limit` of zero.
    #[must_use]
    pub fn clamped_difference(self, other: Self, limit: f64) -> Self {
        Self {
            l: (self.l - other.l).clamp(-limit, limit),
            a: (self.a - other.a).clamp(-limit, limit),
            b: (self.b - other.b).clamp(-limit, limit),
        }
    }
}

/// D65 white in XYZ, as sRGB defines it.
const WHITE: [f64; 3] = [0.950_47, 1.0, 1.088_83];
/// Where CIELAB's cube root turns into a straight line: (6 / 29)^3.
const LAB_EPSILON: f64 = 216.0 / 24_389.0;
/// The slope of that line: (29 / 6)^2 / 3.
const LAB_SLOPE: f64 = 24_389.0 / 27.0 / 116.0;

/// One sRGB channel as linear light, from 0 to 1.
#[must_use]
pub fn linear(byte: u8) -> f64 {
    let c = f64::from(byte) / 255.0;
    if c <= 0.040_45 {
        c / 12.92
    } else {
        libm::pow((c + 0.055) / 1.055, 2.4)
    }
}

/// The CIELAB colour of linear-light red, green and blue, each from 0 to 1.
#[must_use]
pub fn lab_of_linear([r, g, b]: [f64; 3]) -> Lab {
    let x = 0.412_456_4 * r + 0.357_576_1 * g + 0.180_437_5 * b;
    let y = 0.212_672_9 * r + 0.715_152_2 * g + 0.072_175 * b;
    let z = 0.019_333_9 * r + 0.119_192 * g + 0.950_304_1 * b;
    let f = |value: f64, white: f64| {
        let t = value / white;
        if t > LAB_EPSILON {
            libm::cbrt(t)
        } else {
            LAB_SLOPE * t + 16.0 / 116.0
        }
    };
    let (fx, fy, fz) = (f(x, WHITE[0]), f(y, WHITE[1]), f(z, WHITE[2]));
    Lab {
        l: 116.0 * fy - 16.0,
        a: 500.0 * (fx - fy),
        b: 200.0 * (fy - fz),
    }
}

/// The CIELAB colour of sRGB bytes.
#[must_use]
pub fn lab_of_rgb([r, g, b]: [u8; 3]) -> Lab {
    lab_of_linear([linear(r), linear(g), linear(b)])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_srgb_colours_land_at_their_published_cielab_values() {
        // Published CIELAB (D65) values of these sRGB colours, as colour references list them.
        for (rgb, l, a, b) in [
            ([255, 255, 255], 100.0, 0.0, 0.0),
            ([0, 0, 0], 0.0, 0.0, 0.0),
            ([255, 0, 0], 53.24, 80.09, 67.20),
            ([0, 0, 255], 32.30, 79.19, -107.86),
            ([128, 128, 128], 53.59, 0.0, 0.0),
        ] {
            let lab = lab_of_rgb(rgb);
            assert!((lab.l - l).abs() < 0.05, "{rgb:?}: L {}", lab.l);
            assert!((lab.a - a).abs() < 0.05, "{rgb:?}: a {}", lab.a);
            assert!((lab.b - b).abs() < 0.05, "{rgb:?}: b {}", lab.b);
        }
    }

    #[test]
    fn a_difference_is_clamped_on_each_channel() {
        let far = Lab {
            l: 90.0,
            a: -40.0,
            b: 3.0,
        };
        let d = far.clamped_difference(Lab::default(), 12.0);
        assert_eq!((d.l, d.a, d.b), (12.0, -12.0, 3.0));
    }
}
