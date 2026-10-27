//! The gate of the age operations (MnemoCode TS 0.1.0's `CandidateEncryption` and
//! `candidate-encryption-checks.ts`, CAP-RECOVERY-CANDIDATE-ENCRYPTION-GATE, redesigned): their known
//! answers, checked before the first operation and again where the host asks. A check that passed is
//! kept for the gate's life, the process's for the host that holds one; one that failed runs again
//! at the next call. TS's failure epochs and recheck barriers, which order concurrent promises, go:
//! a gate has one caller at a time. The known answers hold public test keys and data, no secret;
//! scrypt's is slow and runs only in the full self-test (`checks`).

use super::admission::{Lock, MAX_ENCRYPTED_BYTES, MAX_HEADER_BYTES, check_encrypted_size, lock};
use super::age::{
    EncryptionError, Identity, Opener, To, decrypt, encrypt, open_with_file_key, seal,
};
use crate::random::Random;
use crate::secret::SecretBytes;
use crate::self_check::vectors::THREE_PHRASES_LIST;
use crate::self_check::{CheckFailure, expect_refused, expect_same, ok};
use crate::text::hex::{bytes_of_hex, hex_of_bytes};

/// vectors/candidates-v1.json, "age": the public test key, never for anything real.
pub(crate) const TEST_IDENTITY: &str =
    "AGE-SECRET-KEY-1J3DXH7J0XJ7HDQ5KT55PD474ZU2S9E0X7N37UZERQSWG4H3Q8NASPUWJ89";
/// Its public test passphrase, never a real one.
pub(crate) const TEST_PASSPHRASE: &str = "public candidate test passphrase";
/// The list of three phrases as age-encryption 0.3.1 wrote it to the test key.
pub(crate) const TO_THE_SESSION_KEY: &str = "6167652d656e6372797074696f6e2e6f72672f76310a2d3e20583235353139206136356439553562555137474f6b35622b3652746b5963424f494650435a54716561665571764e5a4a326f0a54557678394c374742754f746a473346792f4b454f4c2b526344612f613971456c4b41552f517155306e630a2d2d2d204e363162377937377063536b6654314e34384a7177506c6b516b74723268432f71355856665a6f446275380ac627d2859a80b6da35a28846ac0b28c759492f215288a81f00fab74592a8ad30661a38e24bea23b0471d1eee33c7f03509aed8e68eab614d0fa3655102bc25272799f15a1203ceca9dcd57dc00caff920523cac73e2cac07876a7c7ea4e2c8c8";
/// The list of three phrases as age-encryption 0.3.1 wrote it with the test passphrase.
pub(crate) const WITH_THE_PASSPHRASE: &str = "6167652d656e6372797074696f6e2e6f72672f76310a2d3e20736372797074205870525a634577686a5772633579485174772b6843672031380a3273444e75712f66773558356f2b6169326c5244557844733753335a374b3335357a584c58536b2b4a68490a2d2d2d20756e415248654a6f756e436f303350616e58692b733030795239624e7976426849544249617250726465730a2c9d8c5ab6187d40f723d29b32b3e7a700040053411d2ab9923f2ceb2f4f9b24db3c85a38bacab3e6739f621f9b36803f0fb1114f6d9b29ddebf067e976c78439064dda175a4b27e25da4b6ba415caa4bc4128dd532df80e73545c2e5e9f29ab";
/// A file a reader refuses: to the test key and a second one.
pub(crate) const TO_TWO_KEYS: &str = "6167652d656e6372797074696f6e2e6f72672f76310a2d3e20583235353139207161526c654541674e686b486a48706e634f4b624f51516e586d5570323837684572485a53484f42766e550a5a5634345857336f696e50666f394e4d4d506e5a446d7a4c6f552f6549434448614957584f32724f776c410a2d3e2058323535313920745a7472634f306274396c5466463549635238442f2b5958696c42687a75736a79447163652f55727643490a787542476b7342447658657430387266474e53514b67386e4a463064505242323636447441414e57676f380a2d2d2d206d574c39642f4a3873442f2f743251574a7a2f522f505555736b4152486d2f73643530304f4d476f4458550ab7c08cf5243c795f7035d4f881b7c460b23040a088fd25903e24b0afa075ff11188d2bfdc1dc5d61fbba8c14a6dc43696167c21a1cad40ba1099e25edacce5daf085a909d538347a257cae085ae7efc3a2a5776bc3d3f3a69029cfe19f09ee58";
/// A file a reader refuses: scrypt at the work factor 16.
pub(crate) const SCRYPT_WORK_FACTOR_16: &str = "6167652d656e6372797074696f6e2e6f72672f76310a2d3e2073637279707420614d4a6152324771436b374170506164695665374d672031360a755157313975444d6d374143356566516442306639436d637673317542426a4a43412b364a76766b2b6c630a2d2d2d204c71354e462f35396b5476666f2b74544b3730474c4b625033574f65472f74614d4d3678446f7a68694a510adb9d94bc3bcfdec5b7f0c9a34c398ceabaeff4cf8edad31c4a5520b9625fecfd7d9e244681d0db65b5b344fc209bda3587dafe5b4dcef06f6f0cae8f10c406e7bb4cb1166ff33db277bf3a3bcbf32bc0e187ac4d7af32e3a0b878a47f67ab813";
/// The file key of [`TO_THE_SESSION_KEY`], recovered independently (TS's AUD-033 oracle).
const SYMMETRIC_FILE_KEY: &str = "73c254c76d932ab4cf7054d1407fb603";
/// Another public test key: the identity of C2SP CCTV's age test kit (vectors/cctv-age/x25519).
const OTHER_IDENTITY: &str =
    "AGE-SECRET-KEY-1EGTZVFFV20835NWYV6270LXYVK2VKNX2MMDKWYKLMGR48UAWX40Q2P2LM0";
/// Public bytes for a file sealed by the known answers: its X25519 secret and its nonce. Never
/// random, and never a key of anything but these answers.
const SEALED_SECRET: [u8; 32] = [0x5a; 32];
const SEALED_NONCE: [u8; 16] = [0xa5; 16];

/// The gate: whether the known answers passed.
#[derive(Debug, Default)]
pub struct Gate {
    passed: bool,
}

impl Gate {
    /// A gate whose known answers have not run yet.
    pub const fn new() -> Self {
        Self { passed: false }
    }

    /// Opens the gate: runs the known answers unless they passed; refused while one fails.
    pub fn ready(&mut self) -> Result<(), EncryptionError> {
        if !self.passed {
            known_answers().map_err(|_| EncryptionError::SelfTestFailed)?;
            self.passed = true;
        }
        Ok(())
    }

    /// Runs the known answers again, without the kept success; fails as the first one that fails,
    /// and the gate stays closed until they pass.
    pub fn recheck(&mut self) -> Result<(), CheckFailure> {
        self.passed = false;
        known_answers()?;
        self.passed = true;
        Ok(())
    }

    /// A new session key, from the host's randomness, once the gate is open.
    pub fn create_identity(
        &mut self,
        random: &mut dyn Random,
    ) -> Result<Identity, EncryptionError> {
        self.ready()?;
        Ok(Identity::generate(random)?)
    }

    /// [`encrypt`] once the gate is open.
    pub fn encrypt(
        &mut self,
        plain: &[u8],
        to: To<'_>,
        random: &mut dyn Random,
    ) -> Result<SecretBytes, EncryptionError> {
        self.ready()?;
        encrypt(plain, to, random)
    }

    /// [`decrypt`] once the gate is open.
    pub fn decrypt(
        &mut self,
        file: &[u8],
        opener: Opener<'_>,
    ) -> Result<SecretBytes, EncryptionError> {
        self.ready()?;
        Ok(decrypt(file, opener)?)
    }
}

/// The bytes of the hexadecimal `text`, a constant of this module.
fn bytes(text: &str) -> Result<Vec<u8>, CheckFailure> {
    ok(bytes_of_hex(text))
}

/// `file` with its last byte changed: a byte of the encrypted list, which age authenticates.
fn changed_last_byte(text: &str) -> Result<Vec<u8>, CheckFailure> {
    let mut file = bytes(text)?;
    if let Some(last) = file.last_mut() {
        *last ^= 1;
    }
    Ok(file)
}

/// The known answers of the gate, without scrypt: the limits of a file, the published payload
/// under its file key, the published file to the test key, the files a reader refuses, a file
/// changed by a byte, and a list sealed here to the test key and opened again; fails at the first
/// difference.
pub(crate) fn known_answers() -> Result<(), CheckFailure> {
    expect_same(
        &MAX_HEADER_BYTES,
        &65_536,
        "Maximum age header prefix bytes",
    )?;
    expect_same(
        &MAX_ENCRYPTED_BYTES,
        &155_292_688,
        "Maximum encrypted candidate file bytes",
    )?;
    expect_same(
        &ok(lock(&bytes(WITH_THE_PASSPHRASE)?))?,
        &Lock::Passphrase,
        "A scrypt header",
    )?;
    expect_refused(
        check_encrypted_size(MAX_ENCRYPTED_BYTES + 1),
        "core.candidate-file-refusal.encrypted-file-too-large",
        "An oversized encrypted candidate file",
    )?;
    let file_key = bytes(SYMMETRIC_FILE_KEY)?;
    let published = ok(open_with_file_key(&bytes(TO_THE_SESSION_KEY)?, &file_key))?;
    expect_same(
        hex_of_bytes(&published).as_str(),
        THREE_PHRASES_LIST,
        "Published age symmetric payload",
    )?;
    expect_refused(
        open_with_file_key(&changed_last_byte(TO_THE_SESSION_KEY)?, &file_key),
        "core.candidate-file-refusal.contents-damaged",
        "Changed symmetric payload tag",
    )?;
    let malformed = format!("{}A", &TEST_IDENTITY[..TEST_IDENTITY.len() - 1]);
    expect_refused(
        Identity::parse(&malformed),
        "core.candidate-file-refusal.identity-invalid",
        "A malformed Scanner identity",
    )?;
    let identity = ok(Identity::parse(TEST_IDENTITY))?;
    let opened = ok(decrypt(
        &bytes(TO_THE_SESSION_KEY)?,
        Opener::Identity(&identity),
    ))?;
    expect_same(
        hex_of_bytes(&opened).as_str(),
        THREE_PHRASES_LIST,
        "Candidate file to the session key",
    )?;
    expect_refused(
        decrypt(&bytes(TO_TWO_KEYS)?, Opener::Identity(&identity)),
        "core.candidate-file-refusal.several-recipients",
        "A candidate file to two keys",
    )?;
    expect_refused(
        decrypt(
            &bytes(SCRYPT_WORK_FACTOR_16)?,
            Opener::Passphrase(TEST_PASSPHRASE),
        ),
        "core.candidate-file-refusal.scrypt-work-factor-unsupported",
        "A candidate file at the scrypt work factor 16",
    )?;
    expect_refused(
        decrypt(
            &changed_last_byte(TO_THE_SESSION_KEY)?,
            Opener::Identity(&identity),
        ),
        "core.candidate-file-refusal.contents-damaged",
        "A candidate file changed by a byte",
    )?;
    let list = bytes(THREE_PHRASES_LIST)?;
    let recipient = identity.recipient();
    let sealed = ok(seal(
        &list,
        To::Recipient(&recipient),
        &file_key,
        &SEALED_SECRET,
        &SEALED_NONCE,
    ))?;
    let opened = ok(decrypt(&sealed, Opener::Identity(&identity)))?;
    expect_same(
        &*opened,
        list.as_slice(),
        "Candidate file encrypted to the test key",
    )?;
    let other = ok(Identity::parse(OTHER_IDENTITY))?;
    expect_refused(
        decrypt(&sealed, Opener::Identity(&other)),
        "core.candidate-file-refusal.scanner-key-does-not-open",
        "A candidate file opened with another key",
    )
}

/// The known answer of scrypt, slow: the published file opened with the test passphrase.
pub(crate) fn passphrase_answer() -> Result<(), CheckFailure> {
    let opened = ok(decrypt(
        &bytes(WITH_THE_PASSPHRASE)?,
        Opener::Passphrase(TEST_PASSPHRASE),
    ))?;
    expect_same(
        hex_of_bytes(&opened).as_str(),
        THREE_PHRASES_LIST,
        "Candidate file with the passphrase",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::refusal::Refusal;

    #[test]
    fn the_gate_opens_after_its_known_answers() {
        let mut gate = Gate::new();
        assert_eq!(gate.ready(), Ok(()));
        assert_eq!(gate.recheck(), Ok(()));
        let identity = Identity::parse(TEST_IDENTITY).unwrap();
        let opened = gate
            .decrypt(
                &bytes_of_hex(TO_THE_SESSION_KEY).unwrap(),
                Opener::Identity(&identity),
            )
            .unwrap();
        assert_eq!(hex_of_bytes(&opened), THREE_PHRASES_LIST);
        let refusal = gate
            .decrypt(
                &bytes_of_hex(TO_TWO_KEYS).unwrap(),
                Opener::Identity(&identity),
            )
            .unwrap_err();
        assert_eq!(
            refusal.code(),
            "core.candidate-file-refusal.several-recipients"
        );
        assert_eq!(
            EncryptionError::SelfTestFailed.to_string(),
            "Candidate encryption is unavailable because its self-test failed."
        );
    }
}
