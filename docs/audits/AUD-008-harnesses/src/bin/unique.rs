//! JSON decoding that rejects duplicate keys at every object depth.
use serde::de::{Deserialize, Deserializer, Error, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Value};
use std::fmt;

struct Unique(Value);
struct Reader;

impl<'de> Visitor<'de> for Reader {
    type Value = Unique;
    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("JSON with unique object keys")
    }
    fn visit_unit<E: Error>(self) -> Result<Unique, E> {
        Ok(Unique(Value::Null))
    }
    fn visit_bool<E: Error>(self, value: bool) -> Result<Unique, E> {
        Ok(Unique(value.into()))
    }
    fn visit_i64<E: Error>(self, value: i64) -> Result<Unique, E> {
        Ok(Unique(value.into()))
    }
    fn visit_u64<E: Error>(self, value: u64) -> Result<Unique, E> {
        Ok(Unique(value.into()))
    }
    fn visit_f64<E: Error>(self, value: f64) -> Result<Unique, E> {
        Ok(Unique(value.into()))
    }
    fn visit_str<E: Error>(self, value: &str) -> Result<Unique, E> {
        Ok(Unique(value.into()))
    }
    fn visit_string<E: Error>(self, value: String) -> Result<Unique, E> {
        Ok(Unique(value.into()))
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut sequence: A) -> Result<Unique, A::Error> {
        let mut values = Vec::new();
        while let Some(Unique(value)) = sequence.next_element()? {
            values.push(value);
        }
        Ok(Unique(Value::Array(values)))
    }
    fn visit_map<A: MapAccess<'de>>(self, mut source: A) -> Result<Unique, A::Error> {
        let mut values = Map::new();
        while let Some((key, Unique(value))) = source.next_entry::<String, Unique>()? {
            if values.insert(key, value).is_some() {
                return Err(A::Error::custom("duplicate JSON key"));
            }
        }
        Ok(Unique(Value::Object(values)))
    }
}
impl<'de> Deserialize<'de> for Unique {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(Reader)
    }
}
pub fn read(text: &str) -> Result<Value, serde_json::Error> {
    let mut decoder = serde_json::Deserializer::from_str(text);
    let Unique(value) = Unique::deserialize(&mut decoder)?;
    decoder.end()?;
    Ok(value)
}

#[cfg(test)]
mod tests {
    #[test]
    fn nested_duplicate_keys_are_refused() {
        assert!(super::read(r#"{"a":{"x":1,"x":2}}"#).is_err());
        assert!(super::read(r#"{"a":{"x":1},"a":{"y":2}}"#).is_err());
        assert!(super::read(r#"{"a":[1,2],"b":null}"#).is_ok());
    }
}
