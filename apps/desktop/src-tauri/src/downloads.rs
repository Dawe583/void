/// Downloads have a separate policy from top-level navigation. A local Blob
/// export is allowed, but neither a foreign Blob nor a remote URL is trusted.
pub fn allowed(url: &tauri::Url, origin: &str) -> bool {
    if url.scheme() == "blob" {
        return tauri::Url::parse(url.path())
            .map(|inner| inner.scheme() == "http" && inner.origin().ascii_serialization() == origin)
            .unwrap_or(false);
    }
    url.scheme() == "http" && url.origin().ascii_serialization() == origin
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn permits_only_downloads_owned_by_the_local_workbench() {
        let origin = "http://127.0.0.1:4567";
        assert!(allowed(
            &"blob:http://127.0.0.1:4567/uuid".parse().unwrap(),
            origin
        ));
        assert!(allowed(
            &"http://127.0.0.1:4567/export".parse().unwrap(),
            origin
        ));
        for url in [
            "blob:https://attacker.invalid/uuid",
            "https://attacker.invalid/export",
            "blob:null/uuid",
            "file:///tmp/secret",
            "http://127.0.0.1:4568/export",
            "data:text/plain,secret",
        ] {
            assert!(!allowed(&url.parse().unwrap(), origin));
        }
    }
}
