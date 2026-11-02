//! The bundled files of the cards (MnemoCode TS 0.1.0's `RENDER_ASSETS` of `export/platform.ts`):
//! the font, the photographs of the business designs and the material samples, built into the
//! program. Public artwork, under the notices beside it.

/// DejaVu Sans, cut to the characters that MnemoCode prints: the font of every card and sheet.
pub(crate) const UI_FONT: &[u8] = include_bytes!("../assets/fonts/DejaVuSans-UI.ttf");

/// The photographs of the business designs.
#[cfg(feature = "template-business-architect")]
pub(crate) const BUSINESS_ARCHITECT: &[u8] =
    include_bytes!("../assets/images/business-architect-v1.png");
#[cfg(feature = "template-business-contact")]
pub(crate) const BUSINESS_CONTACT: &[u8] =
    include_bytes!("../assets/images/business-contact-v1.png");
#[cfg(feature = "template-business-curves")]
pub(crate) const BUSINESS_CURVES: &[u8] = include_bytes!("../assets/images/business-curves-v1.png");
#[cfg(feature = "template-business-diagonal")]
pub(crate) const BUSINESS_DIAGONAL: &[u8] =
    include_bytes!("../assets/images/business-diagonal-v1.png");
#[cfg(feature = "template-business-estate")]
pub(crate) const BUSINESS_ESTATE: &[u8] = include_bytes!("../assets/images/business-estate-v1.png");
#[cfg(feature = "template-business-facets")]
pub(crate) const BUSINESS_FACETS: &[u8] = include_bytes!("../assets/images/business-facets-v1.png");
#[cfg(feature = "template-business-it")]
pub(crate) const BUSINESS_IT: &[u8] = include_bytes!("../assets/images/business-it-v1.png");

/// The photographs of the material samples.
#[cfg(feature = "template-material-enclosure")]
pub(crate) const MATERIAL_ENCLOSURE: &[u8] =
    include_bytes!("../assets/images/material-enclosure.jpg");
#[cfg(feature = "template-material-kitchen")]
pub(crate) const MATERIAL_KITCHEN: &[u8] = include_bytes!("../assets/images/material-kitchen.jpg");
#[cfg(feature = "template-material-switch")]
pub(crate) const MATERIAL_SWITCH: &[u8] = include_bytes!("../assets/images/material-switch.jpg");
#[cfg(feature = "template-material-tile")]
pub(crate) const MATERIAL_TILE: &[u8] = include_bytes!("../assets/images/material-tile.jpg");
#[cfg(feature = "template-material-vehicle")]
pub(crate) const MATERIAL_VEHICLE: &[u8] = include_bytes!("../assets/images/material-vehicle.jpg");
