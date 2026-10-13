window.onload = function () {
  // Synthetic start-up script in the shape Swagger UI generates; the document below is invented.
  var url = window.location.search.match(/url=([^&]+)/);
  var options = {
    "swaggerDoc": {
      "swagger": "2.0",
      "info": {
        "title": "Widget Feed API",
        "version": "2.0.0",
        "description": "Feeds of published widgets.\nThe braces } and { inside this text, and the quote \" too, must not end the scan."
      },
      "basePath": "/api/feed",
      "paths": {
        "/api/feed/rss/2.0": {
          "get": {
            "operationId": "getRssFeed",
            "summary": "Widget feed as RSS",
            "tags": ["Feeds"],
            "produces": ["application/rss+xml"],
            "responses": { "200": { "description": "The feed" } }
          }
        },
        "/api/feed/catalog/{version}": {
          "parameters": [{ "name": "version", "in": "path", "required": true, "type": "string" }],
          "get": {
            "operationId": "getCatalogFeed",
            "summary": "Widget catalogue feed",
            "tags": ["Feeds"],
            "parameters": [{ "name": "limit", "in": "query", "type": "integer" }],
            "responses": { "200": { "description": "The catalogue", "schema": { "$ref": "#/definitions/Catalog" } } }
          }
        }
      },
      "definitions": {
        "Catalog": {
          "type": "object",
          "description": "A catalogue of widgets.",
          "properties": { "items": { "type": "array", "items": { "type": "string" } } }
        }
      }
    },
    "customOptions": { "docExpansion": "none" }
  };
  url = options.swaggerUrl || url;
  window.ui = SwaggerUIBundle({ spec: options.swaggerDoc, dom_id: '#swagger-ui' });
};
