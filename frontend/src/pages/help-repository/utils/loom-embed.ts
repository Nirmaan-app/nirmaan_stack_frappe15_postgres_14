/**
 * Converts a Loom share URL to an embeddable URL.
 * e.g. "https://www.loom.com/share/abc123?sid=xyz" → "https://www.loom.com/embed/abc123"
 * Falls back to original URL if not a recognized Loom pattern.
 */
export function getLoomEmbedUrl(url: string): string {
	try {
		const parsed = new URL(url)
		if (!parsed.hostname.includes("loom.com")) return url

		const shareMatch = parsed.pathname.match(/\/share\/([a-zA-Z0-9]+)/)
		if (shareMatch) {
			return `https://www.loom.com/embed/${shareMatch[1]}`
		}

		// Already an embed URL
		if (parsed.pathname.startsWith("/embed/")) {
			return `${parsed.origin}${parsed.pathname}`
		}

		return url
	} catch {
		return url
	}
}
