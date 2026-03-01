# API Guide

## Legacy Search
`GET /search?q=<query>[&page=1&limit=10]`

Response:
```json
[
  { "title": "string", "url": "string", "score": 1.23 }
]
```

## Versioned Search
`GET /v1/search?q=<query>&page=1&limit=10&source=<source>&from=<iso>&to=<iso>`

Sources:
- `wikipedia`
- `reddit`
- `hn`
- `arxiv`
- `rss`

Response:
```json
{
  "query": "string",
  "page": 1,
  "limit": 10,
  "total": 42,
  "totalPages": 5,
  "results": [
    {
      "title": "string",
      "url": "string",
      "source": "wikipedia",
      "score": 3.14,
      "snippet": "string",
      "highlights": ["search", "engine"],
      "publishedAt": "2026-03-01T00:00:00.000Z"
    }
  ]
}
```

## Suggestions
`GET /v1/suggest?q=<prefix>&limit=8`

Response:
```json
{
  "query": "sea",
  "suggestions": ["search engine", "search optimization"]
}
```

## Ops Endpoints
- `GET /health`
- `GET /ready`
- `GET /metrics`
- `GET /openapi.json`

## Errors
All structured API errors follow:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request parameters",
    "details": {}
  },
  "requestId": "uuid"
}
```
