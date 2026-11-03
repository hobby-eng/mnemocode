//! Pictures drawn here as PNG files: public test data for the self-test, the tests and the memory
//! scan of the WebAssembly binding, so that no picture file ships with MnemoCode.

/// A PNG file of `width` by `height` RGB pixels, each the colour `pixel` gives its column and row;
/// empty where the encoder refuses the size.
pub(crate) fn png_file(width: u32, height: u32, pixel: impl Fn(u32, u32) -> [u8; 3]) -> Vec<u8> {
    let mut data = Vec::with_capacity(width as usize * height as usize * 3);
    for y in 0..height {
        for x in 0..width {
            data.extend(pixel(x, y));
        }
    }
    let mut file = Vec::new();
    let mut encoder = png::Encoder::new(&mut file, width, height);
    encoder.set_color(png::ColorType::Rgb);
    // The writer finishes the file when it is dropped, at the end of the closure.
    let written = encoder
        .write_header()
        .and_then(|mut writer| writer.write_image_data(&data));
    if written.is_err() {
        return Vec::new();
    }
    file
}

/// A picture of smooth shades, 240 by 160 pixels.
#[must_use]
pub fn gradient_png() -> Vec<u8> {
    let (width, height) = (240, 160);
    png_file(width, height, |x, y| {
        [
            (x * 255 / width) as u8,
            (y * 255 / height) as u8,
            (64 + (x + y) * 127 / (width + height)) as u8,
        ]
    })
}

/// A picture of two flat colours, 200 by 100 pixels, which cannot hold a phrase.
#[must_use]
pub fn two_colours_png() -> Vec<u8> {
    png_file(200, 100, |x, _| {
        if x < 100 {
            [20, 30, 40]
        } else {
            [240, 230, 210]
        }
    })
}
