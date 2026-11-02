//! The decoys of a set of cards and the way its sheet is turned, planned once for the design that
//! draws them (MnemoCode TS 0.1.0's `export/card-plan.ts`, CAP-CARDS-DECOYS-AND-PLAN): a sheet holds
//! the backup's codes and at least one decoy in full rows, with the largest cards that its page
//! allows; separate cards take one decoy without laying out a sheet. Every output of the same
//! layout keeps the same planned cards.

use mnemocode::qr::matrix;
use mnemocode::random::Random;

use crate::content::ColorCards;
use crate::settings::PageSize;
use crate::sheet::frame::collection_payload;
use crate::sheet::{SheetError, plan_collection_sheet};
use crate::templates::{CardDrawing, CardTemplate, TemplateError};

/// `cards` with their decoys, and for a sheet the orientation of its plan where none was given.
/// Existing plans keep their real codes and first decoy unchanged.
pub fn with_planned_decoys(
    template: &CardTemplate,
    drawing: &CardDrawing,
    random: &mut dyn Random,
    cards: &ColorCards,
    separate: bool,
) -> Result<ColorCards, TemplateError> {
    // Checked as every count of decoys is, before the cards are used as they are.
    if let Some(decoys) = cards.decoys {
        cards.own()?;
        if !separate {
            return Ok(cards.clone());
        }
        if decoys > 0 {
            return Ok(cards.kept_individual()?);
        }
    }
    let pool = cards.with_decoy_pool(random)?;
    if separate {
        return Ok(pool.kept_individual()?);
    }
    let settings = &cards.settings;
    let page_size = PageSize::resolve(settings.page_size, false);
    let code = collection_payload(&pool)
        .map(matrix)
        .transpose()
        .map_err(SheetError::from)?;
    template.with_sheet_shape(drawing, &pool, page_size, |shape| {
        let plan = plan_collection_sheet(
            (page_size, settings.orientation),
            cards.own()?,
            pool.codes.colors.len(),
            shape,
            code.as_ref(),
        )?;
        let mut kept = pool.kept(plan.count)?;
        kept.settings.orientation = Some(plan.orientation);
        Ok(kept)
    })
}
