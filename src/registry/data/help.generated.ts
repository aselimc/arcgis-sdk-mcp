// GENERATED FILE, DO NOT EDIT. Written by scripts/import-help-registry.ts from
// scripts/data/help-registry.source.json and scripts/data/help-registry.rules.json.
// Change those files and run `npm run gen`.
import type { AnySourceDef, Product } from '../../core/types.js';

/**
 * Product help (design section 4.6): 76 products of category `product-help`,
 * tombstones included.
 */
export const helpProducts: readonly Product[] = [
  {
    "id": "accessibility",
    "name": "Esri digital accessibility",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Esri guidance on accessible maps and apps: keyboard navigation, content, data visualization and themes.",
    "keywords": [
      "accessibility",
      "a11y",
      "wcag",
      "screen reader",
      "contrast"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/accessibility/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "Esri digital accessibility help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "accessibility",
          "sections": [
            "get-started",
            "accessible-navigation",
            "content",
            "data-visualization",
            "theme"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 24,
        "probe": {
          "url": "https://doc.esri.com/en/accessibility/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 12
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "accessibility"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "esri-a11y"
      ]
    },
    "startHere": [
      {
        "title": "Esri digital accessibility help",
        "ref": "https://doc.esri.com/en/accessibility/latest/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-allsource",
    "name": "ArcGIS AllSource",
    "aliases": [
      "allsource"
    ],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for ArcGIS AllSource, the desktop application for intelligence analysis: link charts, timelines, maps and geoprocessing.",
    "keywords": [
      "intelligence",
      "link chart",
      "timeline",
      "investigation"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-allsource/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS AllSource help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-allsource",
          "sections": [
            "get-started",
            "projects",
            "visualization",
            "data",
            "analysis",
            "production",
            "customization",
            "reference"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 221,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-allsource/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 110
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-allsource"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "allsource"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS AllSource help",
        "ref": "https://doc.esri.com/en/arcgis-allsource/latest/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-autodesk-forma",
    "name": "ArcGIS for Autodesk Forma",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Help for ArcGIS for Autodesk Forma: using ArcGIS data inside Autodesk Forma.",
    "keywords": [
      "autodesk",
      "forma",
      "aec",
      "site design"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-autodesk-forma/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS for Autodesk Forma help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-autodesk-forma",
          "sections": [
            "get-started",
            "workflows"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 9,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-autodesk-forma/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 4
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-autodesk-forma"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "arcgis-for-autodesk-forma"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS for Autodesk Forma help",
        "ref": "https://doc.esri.com/en/arcgis-autodesk-forma/latest/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-data-interoperability",
    "name": "ArcGIS Data Interoperability",
    "aliases": [],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for the ArcGIS Data Interoperability extension: spatial ETL tools and format conversion.",
    "keywords": [
      "etl",
      "spatial etl",
      "workbench",
      "format conversion",
      "fme"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-data-interoperability/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Data Interoperability help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-data-interoperability",
          "sections": [
            "install",
            "help"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 21,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-data-interoperability/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 10
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-data-interoperability"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "data-interop"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Data Interoperability help",
        "ref": "https://doc.esri.com/en/arcgis-data-interoperability/latest/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-data-pipelines",
    "name": "ArcGIS Data Pipelines",
    "aliases": [],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for ArcGIS Data Pipelines: connecting to data sources and preparing data with visual pipelines.",
    "keywords": [
      "data pipeline",
      "data integration",
      "etl",
      "schedule",
      "connector"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-data-pipelines/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Data Pipelines help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-data-pipelines",
          "sections": [
            "install-and-administer",
            "get-started",
            "connect",
            "process"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 75,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-data-pipelines/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 37
        }
      },
      {
        "id": "saas",
        "title": "ArcGIS Data Pipelines help (ArcGIS Online, on doc.arcgis.com)",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/data-pipelines/latest/",
          "books": [
            {
              "path": "connect",
              "tocScript": "/en/data-pipelines/latest/connect/3019.js"
            },
            {
              "path": "get-started",
              "tocScript": "/en/data-pipelines/latest/get-started/3020.js"
            },
            {
              "path": "process",
              "tocScript": "/en/data-pipelines/latest/process/3021.js"
            }
          ]
        },
        "capability": "website",
        "pagesApprox": 65,
        "probe": {
          "url": "https://doc.arcgis.com/en/data-pipelines/latest/connect/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-data-pipelines"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "data-pipelines"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Data Pipelines help",
        "ref": "https://doc.esri.com/en/arcgis-data-pipelines/latest/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-data-reviewer",
    "name": "ArcGIS Data Reviewer",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Help for ArcGIS Data Reviewer: automated and manual data quality checks.",
    "keywords": [
      "data quality",
      "validation",
      "checks",
      "attribute rules",
      "quality control"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-data-reviewer/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.5",
        "label": "11.5",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.4",
        "label": "11.4",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.3",
        "label": "11.3",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.2",
        "label": "11.2",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.1",
        "label": "11.1",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.0",
        "label": "11.0",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.9.1",
        "label": "10.9.1",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.9",
        "label": "10.9",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.8",
        "label": "10.8",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.7",
        "label": "10.7",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.6",
        "label": "10.6",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.5",
        "label": "10.5",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.4",
        "label": "10.4",
        "current": false,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Data Reviewer help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-data-reviewer",
          "sections": [
            "get-started",
            "validate-data"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 11,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-data-reviewer/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 5
        },
        "lines": [
          "latest"
        ]
      },
      {
        "id": "legacy",
        "title": "ArcGIS Data Reviewer Server help, earlier versions",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "enterprise.arcgis.com",
          "base": "/en/data-reviewer/{line}/",
          "books": [
            {
              "path": "help"
            }
          ],
          "lines": [
            "11.5",
            "11.4",
            "11.3",
            "11.2",
            "11.1",
            "11.0",
            "10.9.1",
            "10.9",
            "10.8",
            "10.7",
            "10.6",
            "10.5",
            "10.4"
          ],
          "enumerate": "on-demand"
        },
        "capability": "website",
        "lines": [
          "11.5",
          "11.4",
          "11.3",
          "11.2",
          "11.1",
          "11.0",
          "10.9.1",
          "10.9",
          "10.8",
          "10.7",
          "10.6",
          "10.5",
          "10.4"
        ],
        "pagesApprox": 7,
        "probe": {
          "url": "https://enterprise.arcgis.com/en/data-reviewer/11.5/help/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-data-reviewer"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "data-reviewer",
        "ext-server-reviewer"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Data Reviewer help",
        "ref": "https://doc.esri.com/en/arcgis-data-reviewer/latest/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-doc-center",
    "name": "ArcGIS Documentation Center",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Help for the ArcGIS Documentation Center app, which serves Esri product help offline.",
    "keywords": [
      "offline help",
      "documentation",
      "disconnected"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-doc-center/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Documentation Center help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-doc-center",
          "sections": [
            "get-started",
            "use-the-app",
            "usage-scenarios"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 35,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-doc-center/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 17
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-doc-center"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "arcgis-doc-center"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Documentation Center help",
        "ref": "https://doc.esri.com/en/arcgis-doc-center/latest/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-drone2map",
    "name": "ArcGIS Drone2Map",
    "aliases": [
      "drone2map"
    ],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Help for ArcGIS Drone2Map: processing drone imagery into orthomosaics, elevation models and 3D meshes.",
    "keywords": [
      "drone",
      "uav",
      "orthomosaic",
      "photogrammetry",
      "mesh"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-drone2map/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Drone2Map help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-drone2map",
          "sections": [
            "get-started",
            "help"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 148,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-drone2map/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 74
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-drone2map"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "drone2map"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Drone2Map help",
        "ref": "https://doc.esri.com/en/arcgis-drone2map/latest/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-enterprise",
    "name": "ArcGIS Enterprise",
    "aliases": [],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for ArcGIS Enterprise on Windows and Linux: installing, administering and using the portal, servers and data stores; older versions on demand.",
    "keywords": [
      "portal",
      "federation",
      "data store",
      "web adaptor",
      "install",
      "upgrade",
      "administer",
      "hosting server",
      "backup"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-enterprise/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      },
      {
        "id": "12.0",
        "label": "12.0",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.5",
        "label": "11.5",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.4",
        "label": "11.4",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.3",
        "label": "11.3",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.2",
        "label": "11.2",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.1",
        "label": "11.1",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.0",
        "label": "11.0",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.9.1",
        "label": "10.9.1",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.9",
        "label": "10.9",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.8",
        "label": "10.8",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.7",
        "label": "10.7",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.6",
        "label": "10.6",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.5",
        "label": "10.5",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.4",
        "label": "10.4",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.3",
        "label": "10.3",
        "current": false,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Enterprise help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-enterprise",
          "sections": [
            "introduction",
            "plan",
            "deploy",
            "administer",
            "create",
            "analyze",
            "share",
            "apps"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 1230,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-enterprise/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 615
        },
        "lines": [
          "latest"
        ]
      },
      {
        "id": "legacy-portal",
        "title": "Portal for ArcGIS help, earlier versions",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "enterprise.arcgis.com",
          "base": "/en/portal/{line}/",
          "books": [
            {
              "path": "administer/windows"
            },
            {
              "path": "install/windows"
            },
            {
              "path": "use"
            },
            {
              "path": "administer/linux"
            },
            {
              "path": "install/linux"
            }
          ],
          "lines": [
            "12.0",
            "11.5",
            "11.4",
            "11.3",
            "11.2",
            "11.1",
            "11.0",
            "10.9.1",
            "10.9",
            "10.8",
            "10.7",
            "10.6",
            "10.5",
            "10.4",
            "10.3"
          ],
          "enumerate": "on-demand"
        },
        "capability": "website",
        "lines": [
          "12.0",
          "11.5",
          "11.4",
          "11.3",
          "11.2",
          "11.1",
          "11.0",
          "10.9.1",
          "10.9",
          "10.8",
          "10.7",
          "10.6",
          "10.5",
          "10.4",
          "10.3"
        ],
        "probe": {
          "url": "https://enterprise.arcgis.com/en/portal/11.5/administer/windows/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      },
      {
        "id": "legacy-server",
        "title": "ArcGIS Server help, earlier versions",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "enterprise.arcgis.com",
          "base": "/en/server/{line}/",
          "books": [
            {
              "path": "administer/windows"
            },
            {
              "path": "deploy/windows"
            },
            {
              "path": "develop/windows"
            },
            {
              "path": "get-started/windows"
            },
            {
              "path": "install/windows"
            },
            {
              "path": "manage-data/windows"
            },
            {
              "path": "publish-services/windows"
            },
            {
              "path": "administer/linux"
            },
            {
              "path": "deploy/linux"
            },
            {
              "path": "develop/linux"
            },
            {
              "path": "get-started/linux"
            },
            {
              "path": "install/linux"
            },
            {
              "path": "manage-data/linux"
            },
            {
              "path": "publish-services/linux"
            },
            {
              "path": "cloud/amazon"
            },
            {
              "path": "cloud/azure"
            }
          ],
          "lines": [
            "11.5",
            "11.4",
            "11.3",
            "11.2",
            "11.1",
            "11.0",
            "10.9.1",
            "10.9",
            "10.8",
            "10.7",
            "10.6",
            "10.5",
            "10.4",
            "10.3"
          ],
          "enumerate": "on-demand"
        },
        "capability": "website",
        "lines": [
          "11.5",
          "11.4",
          "11.3",
          "11.2",
          "11.1",
          "11.0",
          "10.9.1",
          "10.9",
          "10.8",
          "10.7",
          "10.6",
          "10.5",
          "10.4",
          "10.3"
        ],
        "probe": {
          "url": "https://enterprise.arcgis.com/en/server/11.5/administer/windows/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      },
      {
        "id": "legacy-data-store",
        "title": "ArcGIS Data Store help, earlier versions",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "enterprise.arcgis.com",
          "base": "/en/data-store/{line}/",
          "books": [
            {
              "path": "install/windows"
            },
            {
              "path": "install/linux"
            }
          ],
          "lines": [
            "12.0",
            "11.5",
            "11.4",
            "11.3",
            "11.2",
            "11.1",
            "11.0",
            "10.9.1",
            "10.9",
            "10.8",
            "10.7",
            "10.6",
            "10.5",
            "10.4",
            "10.3"
          ],
          "enumerate": "on-demand"
        },
        "capability": "website",
        "lines": [
          "12.0",
          "11.5",
          "11.4",
          "11.3",
          "11.2",
          "11.1",
          "11.0",
          "10.9.1",
          "10.9",
          "10.8",
          "10.7",
          "10.6",
          "10.5",
          "10.4",
          "10.3"
        ],
        "probe": {
          "url": "https://enterprise.arcgis.com/en/data-store/11.5/install/windows/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      },
      {
        "id": "legacy-web-adaptor",
        "title": "ArcGIS Web Adaptor help, earlier versions",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "enterprise.arcgis.com",
          "base": "/en/web-adaptor/{line}/",
          "books": [
            {
              "path": "install/iis"
            },
            {
              "path": "install/java-linux"
            },
            {
              "path": "install/java-windows"
            }
          ],
          "lines": [
            "12.0",
            "11.5",
            "11.4",
            "11.3",
            "11.2",
            "11.1",
            "11.0",
            "10.9.1",
            "10.9",
            "10.8",
            "10.7",
            "10.6",
            "10.5",
            "10.4",
            "10.3"
          ],
          "enumerate": "on-demand"
        },
        "capability": "website",
        "lines": [
          "12.0",
          "11.5",
          "11.4",
          "11.3",
          "11.2",
          "11.1",
          "11.0",
          "10.9.1",
          "10.9",
          "10.8",
          "10.7",
          "10.6",
          "10.5",
          "10.4",
          "10.3"
        ],
        "probe": {
          "url": "https://enterprise.arcgis.com/en/web-adaptor/11.5/install/iis/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      },
      {
        "id": "legacy-cloud",
        "title": "ArcGIS Enterprise in the cloud help, earlier versions",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "enterprise.arcgis.com",
          "base": "/en/cloud/{line}/",
          "books": [
            {
              "path": "intro"
            }
          ],
          "lines": [
            "12.0",
            "11.5",
            "11.4",
            "11.3",
            "11.2",
            "11.1",
            "11.0",
            "10.9.1",
            "10.9"
          ],
          "enumerate": "on-demand"
        },
        "capability": "website",
        "lines": [
          "12.0",
          "11.5",
          "11.4",
          "11.3",
          "11.2",
          "11.1",
          "11.0",
          "10.9.1",
          "10.9"
        ],
        "pagesApprox": 4,
        "probe": {
          "url": "https://enterprise.arcgis.com/en/cloud/11.5/intro/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      },
      {
        "id": "legacy-enterprise",
        "title": "ArcGIS Enterprise (install/Builder) help, earlier versions",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "enterprise.arcgis.com",
          "base": "/en/enterprise/{line}/",
          "books": [
            {
              "path": "install/windows"
            },
            {
              "path": "install/linux"
            }
          ],
          "lines": [
            "12.0",
            "11.5",
            "11.4",
            "11.3",
            "11.2",
            "11.1",
            "11.0",
            "10.9.1",
            "10.9",
            "10.8",
            "10.7",
            "10.6",
            "10.5"
          ],
          "enumerate": "on-demand"
        },
        "capability": "website",
        "lines": [
          "12.0",
          "11.5",
          "11.4",
          "11.3",
          "11.2",
          "11.1",
          "11.0",
          "10.9.1",
          "10.9",
          "10.8",
          "10.7",
          "10.6",
          "10.5"
        ],
        "probe": {
          "url": "https://enterprise.arcgis.com/en/enterprise/11.5/install/windows/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      },
      {
        "id": "legacy-get-started",
        "title": "ArcGIS Enterprise get started help, earlier versions",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "enterprise.arcgis.com",
          "base": "/en/get-started/{line}/",
          "books": [
            {
              "path": "windows"
            },
            {
              "path": "linux"
            }
          ],
          "lines": [
            "12.0",
            "11.5",
            "11.4",
            "11.3",
            "11.2",
            "11.1",
            "11.0",
            "10.9.1",
            "10.9",
            "10.8",
            "10.7",
            "10.6",
            "10.5"
          ],
          "enumerate": "on-demand"
        },
        "capability": "website",
        "lines": [
          "12.0",
          "11.5",
          "11.4",
          "11.3",
          "11.2",
          "11.1",
          "11.0",
          "10.9.1",
          "10.9",
          "10.8",
          "10.7",
          "10.6",
          "10.5"
        ],
        "probe": {
          "url": "https://enterprise.arcgis.com/en/get-started/11.5/windows/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      },
      {
        "id": "legacy-system-requirements",
        "title": "ArcGIS Enterprise system requirements help, earlier versions",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "enterprise.arcgis.com",
          "base": "/en/system-requirements/{line}/",
          "books": [
            {
              "path": "windows"
            },
            {
              "path": "linux"
            }
          ],
          "lines": [
            "12.0",
            "11.5",
            "11.4",
            "11.3",
            "11.2",
            "11.1",
            "11.0",
            "10.9.1",
            "10.9",
            "10.8",
            "10.7",
            "10.6",
            "10.5",
            "10.4",
            "10.3"
          ],
          "enumerate": "on-demand"
        },
        "capability": "website",
        "lines": [
          "12.0",
          "11.5",
          "11.4",
          "11.3",
          "11.2",
          "11.1",
          "11.0",
          "10.9.1",
          "10.9",
          "10.8",
          "10.7",
          "10.6",
          "10.5",
          "10.4",
          "10.3"
        ],
        "probe": {
          "url": "https://enterprise.arcgis.com/en/system-requirements/11.5/windows/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      },
      {
        "id": "legacy-notebook",
        "title": "ArcGIS Notebook Server help, earlier versions",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "enterprise.arcgis.com",
          "base": "/en/notebook/{line}/",
          "books": [
            {
              "path": "administer/linux"
            },
            {
              "path": "administer/windows"
            },
            {
              "path": "install/linux"
            },
            {
              "path": "python/linux"
            },
            {
              "path": "use/linux"
            },
            {
              "path": "install/windows"
            },
            {
              "path": "python/windows"
            },
            {
              "path": "use/windows"
            }
          ],
          "lines": [
            "11.5",
            "11.4",
            "11.3",
            "11.2",
            "11.1",
            "11.0",
            "10.9.1",
            "10.9",
            "10.8",
            "10.7"
          ],
          "enumerate": "on-demand"
        },
        "capability": "website",
        "lines": [
          "11.5",
          "11.4",
          "11.3",
          "11.2",
          "11.1",
          "11.0",
          "10.9.1",
          "10.9",
          "10.8",
          "10.7"
        ],
        "probe": {
          "url": "https://enterprise.arcgis.com/en/notebook/11.5/administer/linux/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      },
      {
        "id": "legacy-image",
        "title": "ArcGIS Image Server help, earlier versions",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "enterprise.arcgis.com",
          "base": "/en/image/{line}/",
          "books": [
            {
              "path": "get-started/windows"
            },
            {
              "path": "raster-analytics"
            },
            {
              "path": "get-started/linux"
            }
          ],
          "lines": [
            "11.5",
            "11.4",
            "11.3",
            "11.2",
            "11.1",
            "11.0",
            "10.9.1",
            "10.9",
            "10.8"
          ],
          "enumerate": "on-demand"
        },
        "capability": "website",
        "lines": [
          "11.5",
          "11.4",
          "11.3",
          "11.2",
          "11.1",
          "11.0",
          "10.9.1",
          "10.9",
          "10.8"
        ],
        "probe": {
          "url": "https://enterprise.arcgis.com/en/image/11.5/get-started/windows/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      },
      {
        "id": "legacy-knowledge",
        "title": "ArcGIS Knowledge Server help, earlier versions",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "enterprise.arcgis.com",
          "base": "/en/knowledge/{line}/",
          "books": [
            {
              "path": "deploy"
            },
            {
              "path": "introduction"
            },
            {
              "path": "knowledge-studio"
            }
          ],
          "lines": [
            "11.5",
            "11.4",
            "11.3",
            "11.2",
            "11.1",
            "11.0",
            "10.9.1"
          ],
          "enumerate": "on-demand"
        },
        "capability": "website",
        "lines": [
          "11.5",
          "11.4",
          "11.3",
          "11.2",
          "11.1",
          "11.0",
          "10.9.1"
        ],
        "pagesApprox": 36,
        "probe": {
          "url": "https://enterprise.arcgis.com/en/knowledge/11.5/deploy/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-enterprise"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "arcgis-enterprise"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Enterprise help",
        "ref": "https://doc.esri.com/en/arcgis-enterprise/latest/"
      }
    ],
    "pitfalls": [
      "Earlier versions are read on demand: pass the version, for example 11.5. Their paths differ from the current help, so search within that version instead of rewriting a URL."
    ],
    "related": [
      "enterprise-sdk",
      "enterprise-devops",
      "rest-api",
      "arcgis-server",
      "arcgis-enterprise-k8s"
    ],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-enterprise-cloud-tools",
    "name": "ArcGIS Enterprise cloud tools",
    "aliases": [],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for deploying ArcGIS Enterprise on AWS and Azure with Esri's cloud tools and images.",
    "keywords": [
      "aws",
      "azure",
      "cloud builder",
      "cloudformation",
      "machine image",
      "deployment"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-enterprise-cloud-tools/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Enterprise cloud tools help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-enterprise-cloud-tools",
          "sections": [
            "amazon",
            "azure"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 132,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-enterprise-cloud-tools/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 66
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-enterprise-cloud-tools"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "arcgis-enterprise-cloud"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Enterprise cloud tools help",
        "ref": "https://doc.esri.com/en/arcgis-enterprise-cloud-tools/latest/"
      }
    ],
    "pitfalls": [],
    "related": [
      "arcgis-enterprise",
      "enterprise-devops"
    ],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-enterprise-k8s",
    "name": "ArcGIS Enterprise on Kubernetes",
    "aliases": [],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for ArcGIS Enterprise on Kubernetes: deployment, administration and use.",
    "keywords": [
      "kubernetes",
      "k8s",
      "helm",
      "pods",
      "ingress",
      "cluster"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-enterprise-k8s/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Enterprise on Kubernetes help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-enterprise-k8s",
          "sections": [
            "introduction",
            "deploy",
            "administer",
            "create",
            "analyze",
            "share",
            "apps"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 836,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-enterprise-k8s/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 418
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-enterprise-k8s"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "arcgis-enterprise-k8s"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Enterprise on Kubernetes help",
        "ref": "https://doc.esri.com/en/arcgis-enterprise-k8s/latest/"
      }
    ],
    "pitfalls": [],
    "related": [
      "arcgis-enterprise",
      "enterprise-devops"
    ],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-excalibur",
    "name": "ArcGIS Excalibur",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Help for ArcGIS Excalibur: web-based imagery exploitation and observation projects.",
    "keywords": [
      "imagery",
      "exploitation",
      "observation",
      "imagery project"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-excalibur/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Excalibur help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-excalibur",
          "sections": [
            "get-started",
            "reference"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 32,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-excalibur/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 16
        }
      },
      {
        "id": "saas",
        "title": "ArcGIS Excalibur help (ArcGIS Online, on doc.arcgis.com)",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/excalibur/latest/",
          "books": [
            {
              "path": "get-started",
              "tocScript": "/en/excalibur/latest/get-started/3634.js"
            },
            {
              "path": "reference",
              "tocScript": "/en/excalibur/latest/reference/3648.js"
            }
          ]
        },
        "capability": "website",
        "pagesApprox": 33,
        "probe": {
          "url": "https://doc.arcgis.com/en/excalibur/latest/get-started/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-excalibur"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "excalibur"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Excalibur help",
        "ref": "https://doc.esri.com/en/arcgis-excalibur/latest/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-flight",
    "name": "ArcGIS Flight",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Help for ArcGIS Flight, the mobile app for planning and flying drone data capture.",
    "keywords": [
      "drone",
      "flight plan",
      "capture",
      "uav"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-flight/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Flight help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-flight",
          "sections": [
            "get-started",
            "plan-and-prepare"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 12,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-flight/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 6
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-flight"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "arcgis-flight"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Flight help",
        "ref": "https://doc.esri.com/en/arcgis-flight/latest/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-hub",
    "name": "ArcGIS Hub",
    "aliases": [
      "hub"
    ],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for ArcGIS Hub: sites, pages, initiatives, open data sharing and community engagement.",
    "keywords": [
      "hub site",
      "open data",
      "initiative",
      "community",
      "catalog"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-hub/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Hub help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-hub",
          "sections": [
            "get-started",
            "build",
            "collaborate",
            "engage",
            "administer"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 63,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-hub/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 31
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-hub"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "arcgis-hub"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Hub help",
        "ref": "https://doc.esri.com/en/arcgis-hub/latest/"
      }
    ],
    "pitfalls": [],
    "related": [
      "hub-dev"
    ],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-image-server",
    "name": "ArcGIS Image Server",
    "aliases": [],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for ArcGIS Image Server: image services, raster analytics and hosted imagery.",
    "keywords": [
      "image service",
      "raster analytics",
      "mosaic dataset",
      "imagery hosting"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-image-server/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Image Server help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-image-server",
          "sections": [
            "get-started",
            "image-hosting",
            "raster-analytics"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 274,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-image-server/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 137
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-image-server"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "image-server"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Image Server help",
        "ref": "https://doc.esri.com/en/arcgis-image-server/latest/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-indoors",
    "name": "ArcGIS Indoors",
    "aliases": [
      "indoors"
    ],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for ArcGIS Indoors: indoor maps, floor plans, space planning, wayfinding and the Indoors apps.",
    "keywords": [
      "indoor",
      "floor plan",
      "space planner",
      "wayfinding",
      "reservations"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-indoors/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Indoors help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-indoors",
          "sections": [
            "viewer",
            "mobile",
            "space-planner",
            "floor-plan-editor"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 85,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-indoors/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 42
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-indoors"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "arcgis-indoors"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Indoors help",
        "ref": "https://doc.esri.com/en/arcgis-indoors/latest/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-knowledge",
    "name": "ArcGIS Knowledge",
    "aliases": [],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for ArcGIS Knowledge: knowledge graphs, link charts and graph queries in ArcGIS Enterprise.",
    "keywords": [
      "knowledge graph",
      "link chart",
      "open cypher",
      "entity",
      "relationship"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-knowledge/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Knowledge help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-knowledge",
          "sections": [
            "deploy",
            "introduction",
            "knowledge-studio"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 43,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-knowledge/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 21
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-knowledge"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "arcgis-knowledge"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Knowledge help",
        "ref": "https://doc.esri.com/en/arcgis-knowledge/latest/"
      }
    ],
    "pitfalls": [],
    "related": [
      "knowledge-pbf"
    ],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-maps-microsoft-fabric",
    "name": "ArcGIS Maps for Microsoft Fabric",
    "aliases": [],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for ArcGIS Maps for Microsoft Fabric: maps and spatial analysis inside Microsoft Fabric.",
    "keywords": [
      "fabric",
      "microsoft fabric",
      "onelake",
      "power bi"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-maps-microsoft-fabric/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Maps for Microsoft Fabric help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-maps-microsoft-fabric",
          "sections": [
            "get-started",
            "view",
            "create",
            "configure"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 57,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-maps-microsoft-fabric/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 28
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-maps-microsoft-fabric"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "maps-for-fabric"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Maps for Microsoft Fabric help",
        "ref": "https://doc.esri.com/en/arcgis-maps-microsoft-fabric/latest/"
      }
    ],
    "pitfalls": [],
    "related": [
      "geoanalytics-fabric"
    ],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-maritime",
    "name": "ArcGIS Maritime",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Help for ArcGIS Maritime: nautical chart production and the maritime chart service.",
    "keywords": [
      "nautical chart",
      "s-57",
      "s-101",
      "enc",
      "chart service"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-maritime/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      },
      {
        "id": "12.0",
        "label": "12.0",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.5",
        "label": "11.5",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.4",
        "label": "11.4",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.3",
        "label": "11.3",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.2",
        "label": "11.2",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.1",
        "label": "11.1",
        "current": false,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Maritime help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-maritime",
          "sections": [
            "install",
            "intro",
            "chart-service",
            "chart-builder"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 35,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-maritime/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 17
        },
        "lines": [
          "latest"
        ]
      },
      {
        "id": "legacy",
        "title": "ArcGIS Maritime server help, earlier versions",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "enterprise.arcgis.com",
          "base": "/en/maritime/{line}/",
          "books": [
            {
              "path": "chart-builder/windows"
            },
            {
              "path": "chart-service/windows"
            },
            {
              "path": "intro/windows"
            },
            {
              "path": "chart-builder/linux"
            },
            {
              "path": "chart-service/linux"
            },
            {
              "path": "intro/linux"
            }
          ],
          "lines": [
            "12.0",
            "11.5",
            "11.4",
            "11.3",
            "11.2",
            "11.1"
          ],
          "enumerate": "on-demand"
        },
        "capability": "website",
        "lines": [
          "12.0",
          "11.5",
          "11.4",
          "11.3",
          "11.2",
          "11.1"
        ],
        "probe": {
          "url": "https://enterprise.arcgis.com/en/maritime/12.0/chart-builder/windows/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-maritime"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "arcgis-maritime"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Maritime help",
        "ref": "https://doc.esri.com/en/arcgis-maritime/latest/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-mission",
    "name": "ArcGIS Mission",
    "aliases": [
      "mission"
    ],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for ArcGIS Mission: mission planning, real-time team coordination and the Mission apps.",
    "keywords": [
      "mission",
      "tactical",
      "responder",
      "chat",
      "tracks"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-mission/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Mission help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-mission",
          "sections": [
            "essentials",
            "get-started",
            "manager",
            "responder",
            "server"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 82,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-mission/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 41
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-mission"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "arcgis-mission"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Mission help",
        "ref": "https://doc.esri.com/en/arcgis-mission/latest/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-monitor",
    "name": "ArcGIS Monitor",
    "aliases": [
      "monitor"
    ],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for ArcGIS Monitor: collecting metrics and alerts on the health of an ArcGIS deployment.",
    "keywords": [
      "monitoring",
      "metrics",
      "alerts",
      "health",
      "collection"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-monitor/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.8",
        "label": "10.8",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.7",
        "label": "10.7",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.6",
        "label": "10.6",
        "current": false,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Monitor help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-monitor",
          "sections": [
            "install",
            "get-started",
            "administration"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 126,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-monitor/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 63
        },
        "lines": [
          "latest"
        ]
      },
      {
        "id": "legacy",
        "title": "ArcGIS Monitor (classic 10.x) help, earlier versions",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "enterprise.arcgis.com",
          "base": "/en/monitor/{line}/",
          "books": [
            {
              "path": "administration"
            },
            {
              "path": "get-started"
            },
            {
              "path": "install"
            },
            {
              "path": "reports"
            }
          ],
          "lines": [
            "10.8",
            "10.7",
            "10.6"
          ],
          "enumerate": "on-demand"
        },
        "capability": "website",
        "lines": [
          "10.8",
          "10.7",
          "10.6"
        ],
        "pagesApprox": 80,
        "probe": {
          "url": "https://enterprise.arcgis.com/en/monitor/10.8/administration/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-monitor"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "arcgis-monitor"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Monitor help",
        "ref": "https://doc.esri.com/en/arcgis-monitor/latest/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-notebooks",
    "name": "ArcGIS Notebooks",
    "aliases": [],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for ArcGIS Notebooks and ArcGIS Notebook Server: hosted Python notebooks, runtimes and scheduling.",
    "keywords": [
      "notebook",
      "jupyter",
      "python runtime",
      "schedule",
      "notebook server"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-notebooks/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Notebooks help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-notebooks",
          "sections": [
            "install",
            "use",
            "python",
            "administer"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 70,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-notebooks/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 35
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-notebooks"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "notebook-server",
        "arcgis-notebooks"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Notebooks help",
        "ref": "https://doc.esri.com/en/arcgis-notebooks/latest/"
      }
    ],
    "pitfalls": [],
    "related": [
      "python-api"
    ],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-pipeline-referencing",
    "name": "ArcGIS Pipeline Referencing",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Help for ArcGIS Pipeline Referencing: linear referencing for pipeline networks.",
    "keywords": [
      "pipeline",
      "linear referencing",
      "lrs",
      "route",
      "events"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-pipeline-referencing/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.5",
        "label": "11.5",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.4",
        "label": "11.4",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.3",
        "label": "11.3",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.2",
        "label": "11.2",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.1",
        "label": "11.1",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.0",
        "label": "11.0",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.9.1",
        "label": "10.9.1",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.9",
        "label": "10.9",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.8",
        "label": "10.8",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.7",
        "label": "10.7",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.6",
        "label": "10.6",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.5",
        "label": "10.5",
        "current": false,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Pipeline Referencing help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-pipeline-referencing",
          "sections": [
            "set-up",
            "get-started"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 8,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-pipeline-referencing/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 4
        },
        "lines": [
          "latest"
        ]
      },
      {
        "id": "legacy",
        "title": "ArcGIS Pipeline Referencing help, earlier versions",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "enterprise.arcgis.com",
          "base": "/en/pipeline-referencing/{line}/",
          "books": [
            {
              "path": "get-started"
            }
          ],
          "lines": [
            "11.5",
            "11.4",
            "11.3",
            "11.2",
            "11.1",
            "11.0",
            "10.9.1",
            "10.9",
            "10.8",
            "10.7",
            "10.6",
            "10.5"
          ],
          "enumerate": "on-demand"
        },
        "capability": "website",
        "lines": [
          "11.5",
          "11.4",
          "11.3",
          "11.2",
          "11.1",
          "11.0",
          "10.9.1",
          "10.9",
          "10.8",
          "10.7",
          "10.6",
          "10.5"
        ],
        "pagesApprox": 9,
        "probe": {
          "url": "https://enterprise.arcgis.com/en/pipeline-referencing/11.5/get-started/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-pipeline-referencing"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "ext-server-pipeline"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Pipeline Referencing help",
        "ref": "https://doc.esri.com/en/arcgis-pipeline-referencing/latest/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-pro",
    "name": "ArcGIS Pro",
    "aliases": [],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "End-user help for ArcGIS Pro: projects, mapping, editing, analysis, data management, layouts and sharing.",
    "keywords": [
      "desktop",
      "project",
      "map",
      "layout",
      "geodatabase",
      "editing",
      "symbology",
      "sharing",
      "analysis"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-pro/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      },
      {
        "id": "3.6",
        "label": "Pro 3.6",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "3.5",
        "label": "Pro 3.5",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "3.4",
        "label": "Pro 3.4",
        "current": false,
        "access": "link-only",
        "vars": {}
      },
      {
        "id": "3.3",
        "label": "Pro 3.3",
        "current": false,
        "access": "link-only",
        "vars": {}
      },
      {
        "id": "3.2",
        "label": "Pro 3.2",
        "current": false,
        "access": "link-only",
        "vars": {}
      },
      {
        "id": "3.1",
        "label": "Pro 3.1",
        "current": false,
        "access": "link-only",
        "vars": {}
      },
      {
        "id": "3.0",
        "label": "Pro 3.0",
        "current": false,
        "access": "link-only",
        "vars": {}
      },
      {
        "id": "2.9",
        "label": "Pro 2.9",
        "current": false,
        "access": "link-only",
        "vars": {}
      },
      {
        "id": "2.8",
        "label": "Pro 2.8",
        "current": false,
        "access": "link-only",
        "vars": {}
      },
      {
        "id": "2.7",
        "label": "Pro 2.7",
        "current": false,
        "access": "link-only",
        "vars": {}
      },
      {
        "id": "2.6",
        "label": "Pro 2.6",
        "current": false,
        "access": "link-only",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Pro help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-pro",
          "sections": [
            "get-started",
            "help"
          ]
        },
        "capability": "website",
        "floor": true,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-pro/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri"
        },
        "lines": [
          "latest"
        ]
      },
      {
        "id": "legacy",
        "title": "ArcGIS Pro help, earlier versions",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "pro.arcgis.com",
          "base": "/en/pro-app/{line}/",
          "books": [
            {
              "path": "get-started"
            },
            {
              "path": "help"
            }
          ],
          "lines": [
            "3.6",
            "3.5"
          ],
          "enumerate": "on-demand"
        },
        "capability": "website",
        "lines": [
          "3.6",
          "3.5",
          "3.4",
          "3.3",
          "3.2",
          "3.1",
          "3.0",
          "2.9",
          "2.8",
          "2.7",
          "2.6"
        ],
        "probe": {
          "url": "https://pro.arcgis.com/en/pro-app/3.6/get-started/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-pro"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "arcgis-pro",
        "arcgis-pro-net"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Pro help",
        "ref": "https://doc.esri.com/en/arcgis-pro/latest/"
      }
    ],
    "pitfalls": [
      "ArcPy and the geoprocessing tool reference are product arcpy; the .NET SDK is arcgis-pro-sdk. This product holds the remaining help.",
      "Help of earlier versions is read on demand for the two previous releases; older versions are links only."
    ],
    "related": [
      "arcpy",
      "arcgis-pro-sdk",
      "cim-spec"
    ],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-quickcapture",
    "name": "ArcGIS QuickCapture",
    "aliases": [
      "quickcapture"
    ],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for ArcGIS QuickCapture: big-button field data capture projects and the mobile app.",
    "keywords": [
      "quickcapture",
      "field capture",
      "button",
      "project designer"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-quickcapture/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS QuickCapture help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-quickcapture",
          "sections": [
            "get-started",
            "create",
            "capture"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 32,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-quickcapture/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 16
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-quickcapture"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "quickcapture"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS QuickCapture help",
        "ref": "https://doc.esri.com/en/arcgis-quickcapture/latest/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-reality-server",
    "name": "ArcGIS Reality Server",
    "aliases": [],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for ArcGIS Reality Server: reality mapping processing as an ArcGIS Enterprise server role.",
    "keywords": [
      "reality mapping",
      "photogrammetry",
      "server role",
      "processing"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-reality-server/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Reality Server help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-reality-server",
          "sections": [
            "introduction",
            "explore",
            "deploy"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 8,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-reality-server/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 4
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-reality-server"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "ArcGIS Reality Server"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Reality Server help",
        "ref": "https://doc.esri.com/en/arcgis-reality-server/latest/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-reality-studio",
    "name": "ArcGIS Reality Studio",
    "aliases": [
      "reality-studio"
    ],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Help for ArcGIS Reality Studio: reality mapping from aerial and satellite imagery at city and country scale.",
    "keywords": [
      "reality mapping",
      "aerial imagery",
      "true ortho",
      "3d mesh",
      "alignment"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-reality-studio/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Reality Studio help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-reality-studio",
          "sections": [
            "help"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 70,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-reality-studio/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 35
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-reality-studio"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "arcgisrealitystudio"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Reality Studio help",
        "ref": "https://doc.esri.com/en/arcgis-reality-studio/latest/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-roads-and-highways",
    "name": "ArcGIS Roads and Highways",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Help for ArcGIS Roads and Highways: linear referencing for transportation networks.",
    "keywords": [
      "roads",
      "highways",
      "lrs",
      "linear referencing",
      "event editor"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-roads-and-highways/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.5",
        "label": "11.5",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.4",
        "label": "11.4",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.3",
        "label": "11.3",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.2",
        "label": "11.2",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.1",
        "label": "11.1",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.0",
        "label": "11.0",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.9.1",
        "label": "10.9.1",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.9",
        "label": "10.9",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.8",
        "label": "10.8",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.7",
        "label": "10.7",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.6",
        "label": "10.6",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.5",
        "label": "10.5",
        "current": false,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Roads and Highways help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-roads-and-highways",
          "sections": [
            "set-up",
            "get-started"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 8,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-roads-and-highways/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 4
        },
        "lines": [
          "latest"
        ]
      },
      {
        "id": "legacy",
        "title": "ArcGIS Roads and Highways help, earlier versions",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "enterprise.arcgis.com",
          "base": "/en/roads-highways/{line}/",
          "books": [
            {
              "path": "get-started"
            }
          ],
          "lines": [
            "11.5",
            "11.4",
            "11.3",
            "11.2",
            "11.1",
            "11.0",
            "10.9.1",
            "10.9",
            "10.8",
            "10.7",
            "10.6",
            "10.5"
          ],
          "enumerate": "on-demand"
        },
        "capability": "website",
        "lines": [
          "11.5",
          "11.4",
          "11.3",
          "11.2",
          "11.1",
          "11.0",
          "10.9.1",
          "10.9",
          "10.8",
          "10.7",
          "10.6",
          "10.5"
        ],
        "pagesApprox": 5,
        "probe": {
          "url": "https://enterprise.arcgis.com/en/roads-highways/11.5/get-started/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-roads-and-highways"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "ext-server-roads"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Roads and Highways help",
        "ref": "https://doc.esri.com/en/arcgis-roads-and-highways/latest/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-server",
    "name": "ArcGIS Server",
    "aliases": [],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for stand-alone ArcGIS Server sites: installing, administering and publishing services without a portal.",
    "keywords": [
      "gis server",
      "stand-alone",
      "publish services",
      "server site",
      "server manager"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-server/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Server help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-server",
          "sections": [
            "stand-alone-server"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 25,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-server/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 12
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-server"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "arcgis-server",
        "arcgis-enterprise"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Server help",
        "ref": "https://doc.esri.com/en/arcgis-server/latest/"
      }
    ],
    "pitfalls": [],
    "related": [
      "arcgis-enterprise",
      "rest-api"
    ],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-storymaps",
    "name": "ArcGIS StoryMaps",
    "aliases": [],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for ArcGIS StoryMaps: stories, collections, briefings, themes and embedding.",
    "keywords": [
      "story",
      "storymap",
      "collection",
      "briefing",
      "theme",
      "embed"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-storymaps/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS StoryMaps help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-storymaps",
          "sections": [
            "get-started",
            "author-and-share",
            "share-and-collaborate",
            "learn",
            "reference"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 76,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-storymaps/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 38
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-storymaps"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "arcgis-storymaps"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS StoryMaps help",
        "ref": "https://doc.esri.com/en/arcgis-storymaps/latest/"
      }
    ],
    "pitfalls": [],
    "related": [
      "oss-libraries"
    ],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-topographic-mapping",
    "name": "ArcGIS Topographic Mapping",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Help for ArcGIS Topographic Mapping: producing standard topographic maps and data.",
    "keywords": [
      "topographic",
      "map production",
      "production mapping",
      "defense mapping"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-topographic-mapping/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.5",
        "label": "11.5",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.4",
        "label": "11.4",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.3",
        "label": "11.3",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.2",
        "label": "11.2",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.1",
        "label": "11.1",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.0",
        "label": "11.0",
        "current": false,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Topographic Mapping help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-topographic-mapping",
          "sections": [
            "get-started",
            "workflows",
            "map-production-system",
            "topographic-production-manager"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 50,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-topographic-mapping/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 25
        },
        "lines": [
          "latest"
        ]
      },
      {
        "id": "legacy",
        "title": "ArcGIS Production Mapping server help, earlier versions",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "enterprise.arcgis.com",
          "base": "/en/production-mapping/{line}/",
          "books": [
            {
              "path": "get-started"
            },
            {
              "path": "map-production-system"
            }
          ],
          "lines": [
            "11.5",
            "11.4",
            "11.3",
            "11.2",
            "11.1",
            "11.0"
          ],
          "enumerate": "on-demand"
        },
        "capability": "website",
        "lines": [
          "11.5",
          "11.4",
          "11.3",
          "11.2",
          "11.1",
          "11.0"
        ],
        "pagesApprox": 22,
        "probe": {
          "url": "https://enterprise.arcgis.com/en/production-mapping/11.5/get-started/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-topographic-mapping"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "ArcGIS Topographic Mapping"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Topographic Mapping help",
        "ref": "https://doc.esri.com/en/arcgis-topographic-mapping/latest/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-urban",
    "name": "ArcGIS Urban",
    "aliases": [
      "urban"
    ],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for ArcGIS Urban: plans, projects, zoning, scenarios and indicators for city planning.",
    "keywords": [
      "urban planning",
      "zoning",
      "scenario",
      "plan",
      "indicators"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-urban/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Urban help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-urban",
          "sections": [
            "get-started",
            "data",
            "help"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 86,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-urban/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 43
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-urban"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "urban"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Urban help",
        "ref": "https://doc.esri.com/en/arcgis-urban/latest/"
      }
    ],
    "pitfalls": [],
    "related": [
      "urban-api"
    ],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-velocity",
    "name": "ArcGIS Velocity",
    "aliases": [],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for ArcGIS Velocity: real-time feeds, real-time and big data analytics, and outputs.",
    "keywords": [
      "real-time",
      "iot",
      "feed",
      "big data analytics",
      "stream",
      "geofence"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-velocity/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Velocity help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-velocity",
          "sections": [
            "get-started",
            "ingest",
            "analyze",
            "disseminate-and-notify",
            "reference"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 167,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-velocity/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 83
        }
      },
      {
        "id": "saas",
        "title": "ArcGIS Velocity help (ArcGIS Online, on doc.arcgis.com)",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/velocity/",
          "books": [
            {
              "path": "analyze"
            },
            {
              "path": "disseminate-and-notify"
            },
            {
              "path": "get-started"
            },
            {
              "path": "ingest"
            },
            {
              "path": "manage-data"
            },
            {
              "path": "reference"
            },
            {
              "path": "visualize"
            }
          ]
        },
        "capability": "website",
        "pagesApprox": 163,
        "probe": {
          "url": "https://doc.arcgis.com/en/velocity/analyze/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-velocity"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "arcgis-velocity"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Velocity help",
        "ref": "https://doc.esri.com/en/arcgis-velocity/latest/"
      }
    ],
    "pitfalls": [],
    "related": [
      "velocity-grpc"
    ],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-video-server",
    "name": "ArcGIS Video Server",
    "aliases": [],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for ArcGIS Video Server: publishing and using video services.",
    "keywords": [
      "video service",
      "full motion video",
      "fmv",
      "stream"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-video-server/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.5",
        "label": "11.5",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.4",
        "label": "11.4",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.3",
        "label": "11.3",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.2",
        "label": "11.2",
        "current": false,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Video Server help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-video-server",
          "sections": [
            "install",
            "use"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 23,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-video-server/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 11
        },
        "lines": [
          "latest"
        ]
      },
      {
        "id": "legacy",
        "title": "ArcGIS Video Server help, earlier versions",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "enterprise.arcgis.com",
          "base": "/en/video/{line}/",
          "books": [
            {
              "path": "use"
            }
          ],
          "lines": [
            "11.5",
            "11.4",
            "11.3",
            "11.2"
          ],
          "enumerate": "on-demand"
        },
        "capability": "website",
        "lines": [
          "11.5",
          "11.4",
          "11.3",
          "11.2"
        ],
        "pagesApprox": 10,
        "probe": {
          "url": "https://enterprise.arcgis.com/en/video/11.5/use/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-video-server"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "arcgis-video-server"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Video Server help",
        "ref": "https://doc.esri.com/en/arcgis-video-server/latest/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-workflow-manager",
    "name": "ArcGIS Workflow Manager",
    "aliases": [],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for ArcGIS Workflow Manager: workflow diagrams, jobs, steps and automation of repeatable GIS work.",
    "keywords": [
      "workflow",
      "job",
      "step",
      "diagram",
      "automation"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/arcgis-workflow-manager/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.4",
        "label": "11.4",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.3",
        "label": "11.3",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.2",
        "label": "11.2",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.1",
        "label": "11.1",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "11.0",
        "label": "11.0",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.9.1",
        "label": "10.9.1",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.9",
        "label": "10.9",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.8",
        "label": "10.8",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.7",
        "label": "10.7",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.6",
        "label": "10.6",
        "current": false,
        "access": "live",
        "vars": {}
      },
      {
        "id": "10.5",
        "label": "10.5",
        "current": false,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Workflow Manager help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "arcgis-workflow-manager",
          "sections": [
            "deploy",
            "help",
            "administer"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 112,
        "probe": {
          "url": "https://doc.esri.com/en/arcgis-workflow-manager/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 56
        },
        "lines": [
          "latest"
        ]
      },
      {
        "id": "saas",
        "title": "ArcGIS Workflow Manager help (ArcGIS Online, on doc.arcgis.com)",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/workflow-manager/latest/",
          "books": [
            {
              "path": "administer",
              "tocScript": "/en/workflow-manager/latest/administer/3259.js"
            },
            {
              "path": "help",
              "tocScript": "/en/workflow-manager/latest/help/3241.js"
            }
          ]
        },
        "capability": "website",
        "pagesApprox": 89,
        "probe": {
          "url": "https://doc.arcgis.com/en/workflow-manager/latest/administer/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        },
        "lines": [
          "latest"
        ]
      },
      {
        "id": "legacy",
        "title": "ArcGIS Workflow Manager Server (classic) help, earlier versions",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "enterprise.arcgis.com",
          "base": "/en/workflow-manager/{line}/",
          "books": [
            {
              "path": "help"
            }
          ],
          "lines": [
            "11.4",
            "11.3",
            "11.2",
            "11.1",
            "11.0",
            "10.9.1",
            "10.9",
            "10.8",
            "10.7",
            "10.6",
            "10.5"
          ],
          "enumerate": "on-demand"
        },
        "capability": "website",
        "lines": [
          "11.4",
          "11.3",
          "11.2",
          "11.1",
          "11.0",
          "10.9.1",
          "10.9",
          "10.8",
          "10.7",
          "10.6",
          "10.5"
        ],
        "pagesApprox": 12,
        "probe": {
          "url": "https://enterprise.arcgis.com/en/workflow-manager/11.4/help/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "arcgis-workflow-manager"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "workflow-manager"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Workflow Manager help",
        "ref": "https://doc.esri.com/en/arcgis-workflow-manager/latest/"
      }
    ],
    "pitfalls": [],
    "related": [
      "workflow-manager-dev"
    ],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "deep-learning-studio",
    "name": "Deep Learning Studio",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Help for Deep Learning Studio: a web app for labelling imagery, training deep learning models and running inference.",
    "keywords": [
      "deep learning",
      "training samples",
      "labelling",
      "inference",
      "model training"
    ],
    "languages": [],
    "homepage": "https://doc.esri.com/en/deep-learning-studio/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "Deep Learning Studio help",
        "kinds": [
          "help"
        ],
        "adapter": "docfx-esri",
        "config": {
          "slug": "deep-learning-studio",
          "sections": [
            "get-started",
            "essentials"
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 15,
        "probe": {
          "url": "https://doc.esri.com/en/deep-learning-studio/latest/sitemap.xml",
          "expect": "xml",
          "family": "docfx-esri",
          "minRecords": 7
        }
      }
    ],
    "oracles": [
      {
        "type": "docesri-sitemap",
        "options": {
          "slug": "deep-learning-studio"
        },
        "provides": [
          "documented"
        ]
      }
    ],
    "esearch": {
      "index": "esri_docs_main_v1",
      "site": "esri_docs_main",
      "products": [
        "deep-learning-studio"
      ]
    },
    "startHere": [
      {
        "title": "Deep Learning Studio help",
        "ref": "https://doc.esri.com/en/deep-learning-studio/latest/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-online",
    "name": "ArcGIS Online",
    "aliases": [],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for ArcGIS Online: maps, scenes, hosted layers, analysis, sharing and organization administration, with links to its developer-facing pages.",
    "keywords": [
      "agol",
      "web map",
      "map viewer",
      "hosted feature layer",
      "organization",
      "credits",
      "sharing",
      "item",
      "member roles"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/arcgis-online/get-started/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Online help",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/arcgis-online/",
          "books": [
            {
              "path": "get-started",
              "tocScript": "/en/arcgis-online/get-started/1893.js"
            },
            {
              "path": "create-maps",
              "tocScript": "/en/arcgis-online/create-maps/1304.js"
            },
            {
              "path": "manage-data",
              "tocScript": "/en/arcgis-online/manage-data/2241.js"
            },
            {
              "path": "analyze",
              "tocScript": "/en/arcgis-online/analyze/1934.js"
            },
            {
              "path": "share-maps",
              "tocScript": "/en/arcgis-online/share-maps/1303.js"
            },
            {
              "path": "administer"
            },
            {
              "path": "reference"
            }
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 735,
        "probe": {
          "url": "https://doc.arcgis.com/en/arcgis-online/get-started/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [],
    "esearch": {
      "site": "arcgis_doc_col",
      "products": [
        "arcgis-online"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Online help",
        "ref": "https://doc.arcgis.com/en/arcgis-online/get-started/"
      },
      {
        "title": "URL parameters for maps and apps",
        "ref": "https://doc.arcgis.com/en/arcgis-online/reference/use-url-parameters.htm"
      },
      {
        "title": "Webhooks",
        "ref": "https://doc.arcgis.com/en/arcgis-online/reference/webhooks-online.htm"
      },
      {
        "title": "Security settings: allowed origins and trusted servers",
        "ref": "https://doc.arcgis.com/en/arcgis-online/administer/configure-security.htm"
      },
      {
        "title": "Register an app and get OAuth credentials",
        "ref": "https://doc.arcgis.com/en/arcgis-online/manage-data/add-app-url.htm"
      },
      {
        "title": "Securing hosted layers",
        "ref": "https://doc.arcgis.com/en/arcgis-online/reference/hosted-service-security.htm"
      },
      {
        "title": "SQL reference for hosted layers",
        "ref": "https://doc.arcgis.com/en/arcgis-online/reference/sql-agol.htm"
      },
      {
        "title": "Python libraries available in notebooks",
        "ref": "https://doc.arcgis.com/en/arcgis-online/reference/available-python-libraries.htm"
      }
    ],
    "pitfalls": [
      "The help is unversioned and follows the current ArcGIS Online update."
    ],
    "related": [
      "rest-api",
      "developer-guide"
    ],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "3d-workflows",
    "name": "3D workflows",
    "aliases": [
      "3d"
    ],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Help for Esri's 3D workflows: 3D basemaps, city models and the data preparation behind them.",
    "keywords": [
      "3d basemap",
      "city model",
      "lidar",
      "buildings"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/3d/workflows/analysis/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "3D workflows help",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/3d/",
          "books": [
            {
              "path": "workflows/analysis",
              "tocScript": "/en/3d/workflows/analysis/3309.js"
            },
            {
              "path": "workflows/content",
              "tocScript": "/en/3d/workflows/content/3308.js"
            },
            {
              "path": "workflows/help",
              "tocScript": "/en/3d/workflows/help/3287.js"
            },
            {
              "path": "workflows/immersive-experiences",
              "tocScript": "/en/3d/workflows/immersive-experiences/3307.js"
            },
            {
              "path": "workflows/visualization",
              "tocScript": "/en/3d/workflows/visualization/3306.js"
            }
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 47,
        "probe": {
          "url": "https://doc.arcgis.com/en/3d/workflows/analysis/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [],
    "esearch": {
      "site": "arcgis_doc_col",
      "products": [
        "3d-workflows"
      ]
    },
    "startHere": [
      {
        "title": "3D workflows help",
        "ref": "https://doc.arcgis.com/en/3d/workflows/analysis/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-earth",
    "name": "ArcGIS Earth",
    "aliases": [],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for ArcGIS Earth: a 3D globe viewer for desktop and mobile, with KML, scene layers and administration.",
    "keywords": [
      "earth",
      "globe",
      "kml",
      "3d viewer"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/arcgis-earth/administer/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Earth help",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/arcgis-earth/",
          "books": [
            {
              "path": "administer",
              "tocScript": "/en/arcgis-earth/administer/1784.js"
            },
            {
              "path": "faq",
              "tocScript": "/en/arcgis-earth/faq/980.js"
            },
            {
              "path": "get-started",
              "tocScript": "/en/arcgis-earth/get-started/1881.js"
            },
            {
              "path": "mobile",
              "tocScript": "/en/arcgis-earth/mobile/2479.js"
            },
            {
              "path": "use",
              "tocScript": "/en/arcgis-earth/use/1783.js"
            }
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 58,
        "probe": {
          "url": "https://doc.arcgis.com/en/arcgis-earth/administer/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [],
    "esearch": {
      "site": "arcgis_doc_col",
      "products": [
        "arcgis-earth"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Earth help",
        "ref": "https://doc.arcgis.com/en/arcgis-earth/administer/"
      }
    ],
    "pitfalls": [],
    "related": [
      "earth-automation-api"
    ],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-solutions",
    "name": "ArcGIS Solutions",
    "aliases": [],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for ArcGIS Solutions: deploying and configuring industry solution templates.",
    "keywords": [
      "solutions",
      "industry templates",
      "deploy solution"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/arcgis-solutions/latest/get-started/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Solutions help",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/arcgis-solutions/latest/",
          "books": [
            {
              "path": "get-started"
            },
            {
              "path": "reference"
            },
            {
              "path": "app"
            },
            {
              "path": "tool-reference"
            },
            {
              "path": "tool-reference/utility-network-package"
            },
            {
              "path": "tool-reference/utility-solutions"
            },
            {
              "path": "tool-reference/data-loading"
            }
          ]
        },
        "capability": "website",
        "floor": true,
        "probe": {
          "url": "https://doc.arcgis.com/en/arcgis-solutions/latest/get-started/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [],
    "esearch": {
      "site": "arcgis_doc_col",
      "products": [
        "arcgis-solutions",
        "arcgis-enterprise-solutions"
      ],
      "keepUrl": "/latest/"
    },
    "startHere": [
      {
        "title": "ArcGIS Solutions help",
        "ref": "https://doc.arcgis.com/en/arcgis-solutions/latest/get-started/"
      }
    ],
    "pitfalls": [],
    "related": [
      "oss-libraries"
    ],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-for-autocad",
    "name": "ArcGIS for AutoCAD",
    "aliases": [],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for ArcGIS for AutoCAD: ArcGIS web layers and feature editing inside AutoCAD drawings.",
    "keywords": [
      "autocad",
      "cad",
      "drawing",
      "dwg",
      "feature layer"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/arcgis-for-autocad/latest/extensions/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS for AutoCAD help",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/arcgis-for-autocad/latest/",
          "books": [
            {
              "path": "extensions",
              "tocScript": "/en/arcgis-for-autocad/latest/extensions/3316.js"
            },
            {
              "path": "get-started",
              "tocScript": "/en/arcgis-for-autocad/latest/get-started/3082.js"
            },
            {
              "path": "gis-content",
              "tocScript": "/en/arcgis-for-autocad/latest/gis-content/3083.js"
            },
            {
              "path": "manage",
              "tocScript": "/en/arcgis-for-autocad/latest/manage/3084.js"
            }
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 113,
        "probe": {
          "url": "https://doc.arcgis.com/en/arcgis-for-autocad/latest/extensions/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [],
    "esearch": {
      "site": "arcgis_doc_col",
      "products": [
        "arcgis-for-autocad"
      ],
      "keepUrl": "/latest/"
    },
    "startHere": [
      {
        "title": "ArcGIS for AutoCAD help",
        "ref": "https://doc.arcgis.com/en/arcgis-for-autocad/latest/extensions/"
      }
    ],
    "pitfalls": [],
    "related": [
      "autocad-api"
    ],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-for-excel",
    "name": "ArcGIS for Excel",
    "aliases": [
      "excel"
    ],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Help for ArcGIS for Excel: maps and ArcGIS data inside Microsoft Excel workbooks.",
    "keywords": [
      "excel",
      "workbook",
      "add-in",
      "microsoft 365"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/excel/latest/get-started/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS for Excel help",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/excel/latest/",
          "books": [
            {
              "path": "get-started",
              "tocScript": "/en/excel/latest/get-started/3641.js"
            },
            {
              "path": "workflows",
              "tocScript": "/en/excel/latest/workflows/3642.js"
            }
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 45,
        "probe": {
          "url": "https://doc.arcgis.com/en/excel/latest/get-started/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [],
    "esearch": {
      "site": "arcgis_doc_col",
      "products": [
        "arcgis-for-excel"
      ],
      "keepUrl": "/latest/"
    },
    "startHere": [
      {
        "title": "ArcGIS for Excel help",
        "ref": "https://doc.arcgis.com/en/excel/latest/get-started/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-for-power-automate",
    "name": "ArcGIS for Power Automate",
    "aliases": [
      "power-automate"
    ],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Help for ArcGIS for Power Automate: ArcGIS triggers and actions in Microsoft Power Automate flows.",
    "keywords": [
      "power automate",
      "connector",
      "flow",
      "trigger"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/power-automate/latest/automate/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS for Power Automate help",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/power-automate/latest/",
          "books": [
            {
              "path": "automate",
              "tocScript": "/en/power-automate/latest/automate/3637.js"
            },
            {
              "path": "get-started",
              "tocScript": "/en/power-automate/latest/get-started/3638.js"
            }
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 32,
        "probe": {
          "url": "https://doc.arcgis.com/en/power-automate/latest/automate/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [],
    "esearch": {
      "site": "arcgis_doc_col",
      "products": [
        "arcgis-for-power-automate"
      ],
      "keepUrl": "/latest/"
    },
    "startHere": [
      {
        "title": "ArcGIS for Power Automate help",
        "ref": "https://doc.arcgis.com/en/power-automate/latest/automate/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-for-power-bi",
    "name": "ArcGIS for Power BI",
    "aliases": [
      "power-bi"
    ],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Help for ArcGIS for Power BI: the ArcGIS map visual in Microsoft Power BI reports.",
    "keywords": [
      "power bi",
      "visual",
      "report",
      "reference layer"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/power-bi/latest/get-started/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS for Power BI help",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/power-bi/latest/",
          "books": [
            {
              "path": "get-started",
              "tocScript": "/en/power-bi/latest/get-started/3639.js"
            },
            {
              "path": "workflows",
              "tocScript": "/en/power-bi/latest/workflows/3640.js"
            }
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 54,
        "probe": {
          "url": "https://doc.arcgis.com/en/power-bi/latest/get-started/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [],
    "esearch": {
      "site": "arcgis_doc_col",
      "products": [
        "arcgis-for-power-bi"
      ],
      "keepUrl": "/latest/"
    },
    "startHere": [
      {
        "title": "ArcGIS for Power BI help",
        "ref": "https://doc.arcgis.com/en/power-bi/latest/get-started/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-for-sharepoint",
    "name": "ArcGIS for SharePoint",
    "aliases": [
      "sharepoint"
    ],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Help for ArcGIS for SharePoint: map web parts and geotagged documents in Microsoft SharePoint.",
    "keywords": [
      "sharepoint",
      "web part",
      "geotag",
      "document library"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/sharepoint/latest/get-started/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS for SharePoint help",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/sharepoint/latest/",
          "books": [
            {
              "path": "get-started",
              "tocScript": "/en/sharepoint/latest/get-started/3632.js"
            },
            {
              "path": "workflows",
              "tocScript": "/en/sharepoint/latest/workflows/3633.js"
            }
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 52,
        "probe": {
          "url": "https://doc.arcgis.com/en/sharepoint/latest/get-started/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [],
    "esearch": {
      "site": "arcgis_doc_col",
      "products": [
        "arcgis-for-sharepoint"
      ],
      "keepUrl": "/latest/"
    },
    "startHere": [
      {
        "title": "ArcGIS for SharePoint help",
        "ref": "https://doc.arcgis.com/en/sharepoint/latest/get-started/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-for-teams",
    "name": "ArcGIS for Teams",
    "aliases": [
      "teams"
    ],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Help for ArcGIS for Teams: sharing and viewing ArcGIS maps in Microsoft Teams.",
    "keywords": [
      "microsoft teams",
      "channel",
      "tab",
      "share map"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/teams/latest/get-started/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS for Teams help",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/teams/latest/",
          "books": [
            {
              "path": "get-started",
              "tocScript": "/en/teams/latest/get-started/3635.js"
            },
            {
              "path": "workflows",
              "tocScript": "/en/teams/latest/workflows/3636.js"
            }
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 33,
        "probe": {
          "url": "https://doc.arcgis.com/en/teams/latest/get-started/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [],
    "esearch": {
      "site": "arcgis_doc_col",
      "products": [
        "arcgis-for-teams"
      ],
      "keepUrl": "/latest/"
    },
    "startHere": [
      {
        "title": "ArcGIS for Teams help",
        "ref": "https://doc.arcgis.com/en/teams/latest/get-started/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "geoplanner",
    "name": "ArcGIS GeoPlanner",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Help for ArcGIS GeoPlanner: scenario-based planning and design with dashboards and evaluation models.",
    "keywords": [
      "geodesign",
      "scenario",
      "planning",
      "suitability"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/geoplanner/latest/documentation/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS GeoPlanner help",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/geoplanner/latest/",
          "books": [
            {
              "path": "documentation",
              "tocScript": "/en/geoplanner/latest/documentation/1543.js"
            },
            {
              "path": "get-started",
              "tocScript": "/en/geoplanner/latest/get-started/1541.js"
            }
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 51,
        "probe": {
          "url": "https://doc.arcgis.com/en/geoplanner/latest/documentation/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [],
    "esearch": {
      "site": "arcgis_doc_col",
      "products": [
        "arcgis-geoplanner"
      ],
      "keepUrl": "/latest/"
    },
    "startHere": [
      {
        "title": "ArcGIS GeoPlanner help",
        "ref": "https://doc.arcgis.com/en/geoplanner/latest/documentation/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-ips",
    "name": "ArcGIS IPS",
    "aliases": [
      "ips"
    ],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Help for ArcGIS IPS: indoor positioning with beacons, setup and quality checks.",
    "keywords": [
      "indoor positioning",
      "beacon",
      "bluetooth",
      "blue dot"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/ips/latest/android/mobile/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS IPS help",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/ips/latest/",
          "books": [
            {
              "path": "android/mobile",
              "tocScript": "/en/ips/latest/android/mobile/2905.js"
            },
            {
              "path": "get-started",
              "tocScript": "/en/ips/latest/get-started/2915.js"
            },
            {
              "path": "ios/mobile",
              "tocScript": "/en/ips/latest/ios/mobile/2904.js"
            }
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 38,
        "probe": {
          "url": "https://doc.arcgis.com/en/ips/latest/android/mobile/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [],
    "esearch": {
      "site": "arcgis_doc_col",
      "products": [
        "arcgis-ips",
        "arcgis-ips-android",
        "arcgis-ips-ios"
      ],
      "keepUrl": "/latest/"
    },
    "startHere": [
      {
        "title": "ArcGIS IPS help",
        "ref": "https://doc.arcgis.com/en/ips/latest/android/mobile/"
      }
    ],
    "pitfalls": [],
    "related": [
      "arcgis-indoors"
    ],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "business-analyst",
    "name": "ArcGIS Business Analyst",
    "aliases": [],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for the ArcGIS Business Analyst web, mobile and enterprise apps: sites, reports, infographics and demographic data.",
    "keywords": [
      "market analysis",
      "infographic",
      "report",
      "demographics",
      "site selection",
      "trade area"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/business-analyst/desktop/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Business Analyst help",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/business-analyst/",
          "books": [
            {
              "path": "desktop",
              "tocScript": "/en/business-analyst/desktop/1799.js"
            },
            {
              "path": "enterprise/latest/linux",
              "tocScript": "/en/business-analyst/enterprise/12.1/linux/2800.js"
            },
            {
              "path": "enterprise/latest/windows",
              "tocScript": "/en/business-analyst/enterprise/12.1/windows/259.js"
            },
            {
              "path": "mobile",
              "tocScript": "/en/business-analyst/mobile/1660.js"
            },
            {
              "path": "web",
              "tocScript": "/en/business-analyst/web/2034.js"
            }
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 114,
        "probe": {
          "url": "https://doc.arcgis.com/en/business-analyst/desktop/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [],
    "esearch": {
      "site": "arcgis_doc_col",
      "products": [
        "bus-analyst-online"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Business Analyst help",
        "ref": "https://doc.arcgis.com/en/business-analyst/desktop/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "collector-classic",
    "name": "Collector for ArcGIS (classic)",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "retired",
    "successor": "field-maps",
    "summary": "Retired mobile data collection app; replaced by ArcGIS Field Maps.",
    "keywords": [
      "collector",
      "data collection"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/collector-classic/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Retired",
        "current": true,
        "access": "link-only",
        "vars": {}
      }
    ],
    "sources": [],
    "oracles": [],
    "startHere": [
      {
        "title": "Collector for ArcGIS (classic) help (retired)",
        "ref": "https://doc.arcgis.com/en/collector-classic/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "data-appliance",
    "name": "ArcGIS Data Appliance",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Help for ArcGIS Data Appliance: basemaps and reference data delivered for disconnected ArcGIS Enterprise deployments.",
    "keywords": [
      "basemap",
      "disconnected",
      "appliance",
      "tile cache"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/data-appliance/latest/get-started/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Data Appliance help",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/data-appliance/latest/",
          "books": [
            {
              "path": "get-started",
              "tocScript": "/en/data-appliance/2026/get-started/1593.js"
            },
            {
              "path": "imagery-elevation",
              "tocScript": "/en/data-appliance/2026/imagery-elevation/3656.js"
            },
            {
              "path": "open-vector-basemaps",
              "tocScript": "/en/data-appliance/2026/open-vector-basemaps/3657.js"
            },
            {
              "path": "vector-basemaps",
              "tocScript": "/en/data-appliance/2026/vector-basemaps/2220.js"
            },
            {
              "path": "world-gazetteer",
              "tocScript": "/en/data-appliance/2026/world-gazetteer/3366.js"
            }
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 85,
        "probe": {
          "url": "https://doc.arcgis.com/en/data-appliance/latest/get-started/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [],
    "esearch": {
      "site": "arcgis_doc_col",
      "products": [
        "data-appliance"
      ],
      "keepUrl": "/latest/"
    },
    "startHere": [
      {
        "title": "ArcGIS Data Appliance help",
        "ref": "https://doc.arcgis.com/en/data-appliance/latest/get-started/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "esri-demographics",
    "name": "Esri Demographics",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Reference for Esri Demographics and ArcGIS Places data: datasets, variables, vintages and methodology by country.",
    "keywords": [
      "demographics",
      "variables",
      "census",
      "tapestry",
      "places data",
      "methodology"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/esri-demographics/latest/arcgis-places/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "Esri Demographics help",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/esri-demographics/latest/",
          "books": [
            {
              "path": "arcgis-places",
              "tocScript": "/en/esri-demographics/latest/arcgis-places/3611.js"
            },
            {
              "path": "esri-demographics",
              "tocScript": "/en/esri-demographics/latest/esri-demographics/3612.js"
            },
            {
              "path": "get-started",
              "tocScript": "/en/esri-demographics/latest/get-started/3035.js"
            },
            {
              "path": "reference",
              "tocScript": "/en/esri-demographics/latest/reference/1528.js"
            }
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 285,
        "probe": {
          "url": "https://doc.arcgis.com/en/esri-demographics/latest/arcgis-places/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [],
    "esearch": {
      "site": "arcgis_doc_col",
      "products": [
        "esri-demographics"
      ],
      "keepUrl": "/latest/"
    },
    "startHere": [
      {
        "title": "Esri Demographics help",
        "ref": "https://doc.arcgis.com/en/esri-demographics/latest/arcgis-places/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "redistricting",
    "name": "Esri Redistricting",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Help for Esri Redistricting: building, evaluating and sharing redistricting plans.",
    "keywords": [
      "redistricting",
      "district plan",
      "census blocks"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/redistricting/administer/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "Esri Redistricting help",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/redistricting/",
          "books": [
            {
              "path": "administer",
              "tocScript": "/en/redistricting/administer/602.js"
            },
            {
              "path": "analyze",
              "tocScript": "/en/redistricting/analyze/2657.js"
            },
            {
              "path": "collaborate",
              "tocScript": "/en/redistricting/collaborate/2656.js"
            },
            {
              "path": "create-edit",
              "tocScript": "/en/redistricting/create-edit/2655.js"
            },
            {
              "path": "get-started",
              "tocScript": "/en/redistricting/get-started/673.js"
            },
            {
              "path": "review",
              "tocScript": "/en/redistricting/review/2658.js"
            }
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 137,
        "probe": {
          "url": "https://doc.arcgis.com/en/redistricting/administer/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [],
    "esearch": {
      "site": "arcgis_doc_col",
      "products": [
        "esri-redistricting"
      ]
    },
    "startHere": [
      {
        "title": "Esri Redistricting help",
        "ref": "https://doc.arcgis.com/en/redistricting/administer/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "experience-builder-help",
    "name": "ArcGIS Experience Builder help",
    "aliases": [],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "End-user help for ArcGIS Experience Builder: building experiences from widgets, pages, templates and data.",
    "keywords": [
      "experience",
      "widget configuration",
      "template",
      "page",
      "no-code"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/experience-builder/latest/build-apps/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Experience Builder help help",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/experience-builder/latest/",
          "books": [
            {
              "path": "build-apps",
              "tocScript": "/en/experience-builder/latest/build-apps/2533.js"
            },
            {
              "path": "configure-widgets",
              "tocScript": "/en/experience-builder/latest/configure-widgets/2546.js"
            },
            {
              "path": "get-started",
              "tocScript": "/en/experience-builder/latest/get-started/2543.js"
            }
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 96,
        "probe": {
          "url": "https://doc.arcgis.com/en/experience-builder/latest/build-apps/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [],
    "esearch": {
      "site": "arcgis_doc_col",
      "products": [
        "experience-builder"
      ],
      "keepUrl": "/latest/"
    },
    "startHere": [
      {
        "title": "ArcGIS Experience Builder help help",
        "ref": "https://doc.arcgis.com/en/experience-builder/latest/build-apps/"
      }
    ],
    "pitfalls": [
      "Writing custom widgets and themes is documented in the developer edition product, experience-builder."
    ],
    "related": [
      "experience-builder"
    ],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "explorer",
    "name": "ArcGIS Explorer",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "retired",
    "successor": "field-maps",
    "summary": "Retired mobile map viewer app; replaced by ArcGIS Field Maps.",
    "keywords": [
      "explorer",
      "map viewer",
      "markup"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/explorer/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Retired",
        "current": true,
        "access": "link-only",
        "vars": {}
      }
    ],
    "sources": [],
    "oracles": [],
    "startHere": [
      {
        "title": "ArcGIS Explorer help (retired)",
        "ref": "https://doc.arcgis.com/en/explorer/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "field-maps",
    "name": "ArcGIS Field Maps",
    "aliases": [],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for ArcGIS Field Maps: map and form configuration, mobile data collection, location sharing and offline areas.",
    "keywords": [
      "field maps",
      "smart form",
      "offline area",
      "location sharing",
      "mobile collection"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/field-maps/latest/prepare-maps/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Field Maps help",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/field-maps/",
          "books": [
            {
              "path": "latest/prepare-maps",
              "tocScript": "/en/field-maps/latest/prepare-maps/3368.js"
            },
            {
              "path": "get-started"
            },
            {
              "path": "android/use-maps"
            },
            {
              "path": "ios/use-maps"
            }
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 41,
        "probe": {
          "url": "https://doc.arcgis.com/en/field-maps/latest/prepare-maps/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [],
    "esearch": {
      "site": "arcgis_doc_col",
      "products": [
        "field-maps",
        "field-maps-android",
        "field-maps-ios"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Field Maps help",
        "ref": "https://doc.arcgis.com/en/field-maps/latest/prepare-maps/"
      }
    ],
    "pitfalls": [],
    "related": [
      "oss-libraries"
    ],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "geobim",
    "name": "ArcGIS GeoBIM",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Help for ArcGIS GeoBIM: linking ArcGIS content with Autodesk BIM projects and documents.",
    "keywords": [
      "bim",
      "autodesk",
      "construction cloud",
      "aec"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/geobim/latest/create/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS GeoBIM help",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/geobim/latest/",
          "books": [
            {
              "path": "create",
              "tocScript": "/en/geobim/latest/create/2873.js"
            },
            {
              "path": "engage",
              "tocScript": "/en/geobim/latest/engage/3660.js"
            },
            {
              "path": "get-started",
              "tocScript": "/en/geobim/latest/get-started/2874.js"
            },
            {
              "path": "manage",
              "tocScript": "/en/geobim/latest/manage/3661.js"
            },
            {
              "path": "sync",
              "tocScript": "/en/geobim/latest/sync/3659.js"
            }
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 66,
        "probe": {
          "url": "https://doc.arcgis.com/en/geobim/latest/create/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [],
    "esearch": {
      "site": "arcgis_doc_col",
      "products": [
        "geobim"
      ],
      "keepUrl": "/latest/"
    },
    "startHere": [
      {
        "title": "ArcGIS GeoBIM help",
        "ref": "https://doc.arcgis.com/en/geobim/latest/create/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "imagery-workflows",
    "name": "Imagery workflows",
    "aliases": [
      "imagery"
    ],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Help for Esri imagery workflows: step-by-step guidance for managing, analysing and sharing imagery and rasters.",
    "keywords": [
      "imagery",
      "mosaic dataset",
      "ortho mapping",
      "raster",
      "workflow"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/imagery/workflows/best-practices/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "Imagery workflows help",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/imagery/",
          "books": [
            {
              "path": "workflows/best-practices",
              "tocScript": "/en/imagery/workflows/best-practices/2399.js"
            },
            {
              "path": "workflows/browse-imagery/workflow",
              "tocScript": "/en/imagery/workflows/browse-imagery/workflow/2023.js"
            },
            {
              "path": "workflows/managing-elevation/try-it-out",
              "tocScript": "/en/imagery/workflows/managing-elevation/try-it-out/1972.js"
            },
            {
              "path": "workflows/managing-elevation/workflow",
              "tocScript": "/en/imagery/workflows/managing-elevation/workflow/1971.js"
            },
            {
              "path": "workflows/managing-high-resolution-satellite-data/overview",
              "tocScript": "/en/imagery/workflows/managing-high-resolution-satellite-data/overview/2126.js"
            },
            {
              "path": "workflows/managing-high-resolution-satellite-data/try-it-out",
              "tocScript": "/en/imagery/workflows/managing-high-resolution-satellite-data/try-it-out/2127.js"
            },
            {
              "path": "workflows/managing-high-resolution-satellite-data/workflow",
              "tocScript": "/en/imagery/workflows/managing-high-resolution-satellite-data/workflow/2128.js"
            },
            {
              "path": "workflows/managing-preprocessed-orthophotos/try-it-out",
              "tocScript": "/en/imagery/workflows/managing-preprocessed-orthophotos/try-it-out/2016.js"
            },
            {
              "path": "workflows/managing-scanned-maps/workflow",
              "tocScript": "/en/imagery/workflows/managing-scanned-maps/workflow/2026.js"
            },
            {
              "path": "workflows/resources",
              "tocScript": "/en/imagery/workflows/resources/2371.js"
            },
            {
              "path": "workflows/standard-workflow/overview",
              "tocScript": "/en/imagery/workflows/standard-workflow/overview/2049.js"
            },
            {
              "path": "workflows/standard-workflow/publishing-and-maintenance",
              "tocScript": "/en/imagery/workflows/standard-workflow/publishing-and-maintenance/2047.js"
            },
            {
              "path": "workflows/tutorials",
              "tocScript": "/en/imagery/workflows/tutorials/2393.js"
            },
            {
              "path": "workflows/browse-imagery/overview",
              "tocScript": "/en/imagery/workflows/browse-imagery/overview/2021.js"
            },
            {
              "path": "workflows/browse-imagery/try-it-out",
              "tocScript": "/en/imagery/workflows/browse-imagery/try-it-out/2022.js"
            },
            {
              "path": "workflows/managing-elevation/overview",
              "tocScript": "/en/imagery/workflows/managing-elevation/overview/1970.js"
            },
            {
              "path": "workflows/managing-preprocessed-orthophotos/overview",
              "tocScript": "/en/imagery/workflows/managing-preprocessed-orthophotos/overview/2015.js"
            },
            {
              "path": "workflows/managing-preprocessed-orthophotos/workflow",
              "tocScript": "/en/imagery/workflows/managing-preprocessed-orthophotos/workflow/2017.js"
            },
            {
              "path": "workflows/managing-scanned-maps/overview",
              "tocScript": "/en/imagery/workflows/managing-scanned-maps/overview/2024.js"
            },
            {
              "path": "workflows/standard-workflow/creating-mosaic-datasets",
              "tocScript": "/en/imagery/workflows/standard-workflow/creating-mosaic-datasets/2046.js"
            },
            {
              "path": "workflows/standard-workflow/preparing-your-data",
              "tocScript": "/en/imagery/workflows/standard-workflow/preparing-your-data/2048.js"
            }
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 147,
        "probe": {
          "url": "https://doc.arcgis.com/en/imagery/workflows/best-practices/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [],
    "esearch": {
      "site": "arcgis_doc_col",
      "products": [
        "imagery-workflows"
      ]
    },
    "startHere": [
      {
        "title": "Imagery workflows help",
        "ref": "https://doc.arcgis.com/en/imagery/workflows/best-practices/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "insights",
    "name": "ArcGIS Insights",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "retired",
    "summary": "Retired analysis workbench for exploratory spatial and tabular analysis.",
    "keywords": [
      "insights",
      "workbook",
      "exploratory analysis"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/insights/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Retired",
        "current": true,
        "access": "link-only",
        "vars": {}
      }
    ],
    "sources": [],
    "oracles": [],
    "startHere": [
      {
        "title": "ArcGIS Insights help (retired)",
        "ref": "https://doc.arcgis.com/en/insights/latest/"
      },
      {
        "title": "Deprecation notice",
        "ref": "https://support.esri.com/en-us/knowledge-base/deprecation-arcgis-insights-000034240"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "instant-apps",
    "name": "ArcGIS Instant Apps",
    "aliases": [],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for ArcGIS Instant Apps: configuring template-based web apps from maps and scenes.",
    "keywords": [
      "instant app",
      "app template",
      "configurable app"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/instant-apps/latest/create-apps/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Instant Apps help",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/instant-apps/latest/",
          "books": [
            {
              "path": "create-apps",
              "tocScript": "/en/instant-apps/latest/create-apps/2834.js"
            },
            {
              "path": "customize",
              "tocScript": "/en/instant-apps/latest/customize/2833.js"
            },
            {
              "path": "get-started",
              "tocScript": "/en/instant-apps/latest/get-started/2832.js"
            }
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 47,
        "probe": {
          "url": "https://doc.arcgis.com/en/instant-apps/latest/create-apps/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [],
    "esearch": {
      "site": "arcgis_doc_col",
      "products": [
        "instant-apps"
      ],
      "keepUrl": "/latest/"
    },
    "startHere": [
      {
        "title": "ArcGIS Instant Apps help",
        "ref": "https://doc.arcgis.com/en/instant-apps/latest/create-apps/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "maps-for-adobecc",
    "name": "ArcGIS Maps for Adobe Creative Cloud",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Help for ArcGIS Maps for Adobe Creative Cloud: map design with ArcGIS data in Illustrator and Photoshop.",
    "keywords": [
      "adobe",
      "illustrator",
      "photoshop",
      "cartography"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/maps-for-adobecc/latest/compile-maps/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Maps for Adobe Creative Cloud help",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/maps-for-adobecc/latest/",
          "books": [
            {
              "path": "compile-maps",
              "tocScript": "/en/maps-for-adobecc/latest/compile-maps/1523.js"
            },
            {
              "path": "install",
              "tocScript": "/en/maps-for-adobecc/latest/install/753.js"
            },
            {
              "path": "mapboards",
              "tocScript": "/en/maps-for-adobecc/latest/mapboards/1938.js"
            },
            {
              "path": "sync-content",
              "tocScript": "/en/maps-for-adobecc/latest/sync-content/1964.js"
            }
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 36,
        "probe": {
          "url": "https://doc.arcgis.com/en/maps-for-adobecc/latest/compile-maps/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [],
    "esearch": {
      "site": "arcgis_doc_col",
      "products": [
        "maps-for-adobecc"
      ],
      "keepUrl": "/latest/"
    },
    "startHere": [
      {
        "title": "ArcGIS Maps for Adobe Creative Cloud help",
        "ref": "https://doc.arcgis.com/en/maps-for-adobecc/latest/compile-maps/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "microsoft-planetary-computer",
    "name": "ArcGIS for Microsoft Planetary Computer",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Help for ArcGIS for Microsoft Planetary Computer: using Planetary Computer data with ArcGIS.",
    "keywords": [
      "planetary computer",
      "azure",
      "stac",
      "earth observation"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/microsoft-planetary-computer/latest/get-started/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS for Microsoft Planetary Computer help",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/microsoft-planetary-computer/latest/",
          "books": [
            {
              "path": "get-started",
              "tocScript": "/en/microsoft-planetary-computer/2023.1/get-started/3415.js"
            },
            {
              "path": "help",
              "tocScript": "/en/microsoft-planetary-computer/2023.1/help/3416.js"
            }
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 5,
        "probe": {
          "url": "https://doc.arcgis.com/en/microsoft-planetary-computer/latest/get-started/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [],
    "esearch": {
      "site": "arcgis_doc_col",
      "products": [
        "microsoft-planetary-computer"
      ],
      "keepUrl": "/latest/"
    },
    "startHere": [
      {
        "title": "ArcGIS for Microsoft Planetary Computer help",
        "ref": "https://doc.arcgis.com/en/microsoft-planetary-computer/latest/get-started/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "navigator",
    "name": "ArcGIS Navigator",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Help for ArcGIS Navigator: turn-by-turn navigation for field workforces with custom and offline maps.",
    "keywords": [
      "navigation",
      "turn-by-turn",
      "route",
      "offline map",
      "mobile"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/navigator/android-phone/help/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Navigator help",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/navigator/",
          "books": [
            {
              "path": "android-phone/help"
            },
            {
              "path": "android-tablet/help"
            },
            {
              "path": "faqs"
            },
            {
              "path": "ipad/help"
            },
            {
              "path": "iphone/help"
            }
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 48,
        "probe": {
          "url": "https://doc.arcgis.com/en/navigator/android-phone/help/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [],
    "esearch": {
      "site": "arcgis_doc_col",
      "products": [
        "navigator-android-phone",
        "navigator-android-tablet",
        "navigator-ipad",
        "navigator-iphone"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Navigator help",
        "ref": "https://doc.arcgis.com/en/navigator/android-phone/help/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "dashboards",
    "name": "ArcGIS Dashboards",
    "aliases": [],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for ArcGIS Dashboards: elements, data expressions, actions, selectors and URL parameters.",
    "keywords": [
      "dashboard",
      "indicator",
      "chart",
      "selector",
      "data expression",
      "url parameters"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/dashboards/latest/create-and-share/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Dashboards help",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/dashboards/latest/",
          "books": [
            {
              "path": "create-and-share",
              "tocScript": "/en/dashboards/latest/create-and-share/2539.js"
            },
            {
              "path": "get-started",
              "tocScript": "/en/dashboards/latest/get-started/2171.js"
            },
            {
              "path": "reference",
              "tocScript": "/en/dashboards/latest/reference/2199.js"
            }
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 65,
        "probe": {
          "url": "https://doc.arcgis.com/en/dashboards/latest/create-and-share/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [],
    "esearch": {
      "site": "arcgis_doc_col",
      "products": [
        "ops-dashboard"
      ],
      "keepUrl": "/latest/"
    },
    "startHere": [
      {
        "title": "ArcGIS Dashboards help",
        "ref": "https://doc.arcgis.com/en/dashboards/latest/create-and-share/"
      }
    ],
    "pitfalls": [],
    "related": [
      "arcade"
    ],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "pretrained-models",
    "name": "ArcGIS pretrained deep learning models",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Help for the ArcGIS pretrained deep learning models: what each model detects or classifies and how to run it.",
    "keywords": [
      "deep learning package",
      "dlpk",
      "object detection",
      "classification",
      "geoai"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/pretrained-models/latest/get-started/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS pretrained deep learning models help",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/pretrained-models/latest/",
          "books": [
            {
              "path": "get-started",
              "tocScript": "/en/pretrained-models/latest/get-started/1701.js"
            },
            {
              "path": "imagery",
              "tocScript": "/en/pretrained-models/latest/imagery/2863.js"
            },
            {
              "path": "point-cloud",
              "tocScript": "/en/pretrained-models/latest/point-cloud/2864.js"
            },
            {
              "path": "text",
              "tocScript": "/en/pretrained-models/latest/text/3039.js"
            },
            {
              "path": "timeseries",
              "tocScript": "/en/pretrained-models/latest/timeseries/3628.js"
            },
            {
              "path": "vector",
              "tocScript": "/en/pretrained-models/latest/vector/3728.js"
            }
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 269,
        "probe": {
          "url": "https://doc.arcgis.com/en/pretrained-models/latest/get-started/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [],
    "esearch": {
      "site": "arcgis_doc_col",
      "products": [
        "pretrained-models"
      ],
      "keepUrl": "/latest/"
    },
    "startHere": [
      {
        "title": "ArcGIS pretrained deep learning models help",
        "ref": "https://doc.arcgis.com/en/pretrained-models/latest/get-started/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "pro-intelligence",
    "name": "ArcGIS Pro Intelligence",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "retired",
    "successor": "arcgis-allsource",
    "summary": "Retired intelligence configuration of ArcGIS Pro; replaced by ArcGIS AllSource.",
    "keywords": [
      "intelligence",
      "pro intelligence"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/pro-intelligence/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Retired",
        "current": true,
        "access": "link-only",
        "vars": {}
      }
    ],
    "sources": [],
    "oracles": [],
    "startHere": [
      {
        "title": "ArcGIS Pro Intelligence help (retired)",
        "ref": "https://doc.arcgis.com/en/pro-intelligence/latest/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "streetmap-premium",
    "name": "ArcGIS StreetMap Premium",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Help for ArcGIS StreetMap Premium: street data for geocoding, routing and cartography.",
    "keywords": [
      "street data",
      "locator",
      "network dataset",
      "routing data"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/streetmap-premium/latest/coverage/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS StreetMap Premium help",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/streetmap-premium/latest/",
          "books": [
            {
              "path": "coverage",
              "tocScript": "/en/streetmap-premium/latest/coverage/1703.js"
            },
            {
              "path": "current-releases",
              "tocScript": "/en/streetmap-premium/latest/current-releases/2414.js"
            },
            {
              "path": "get-started",
              "tocScript": "/en/streetmap-premium/latest/get-started/1704.js"
            }
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 37,
        "probe": {
          "url": "https://doc.arcgis.com/en/streetmap-premium/latest/coverage/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [],
    "esearch": {
      "site": "arcgis_doc_col",
      "products": [
        "streetmap-premium"
      ],
      "keepUrl": "/latest/"
    },
    "startHere": [
      {
        "title": "ArcGIS StreetMap Premium help",
        "ref": "https://doc.arcgis.com/en/streetmap-premium/latest/coverage/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "survey123",
    "name": "ArcGIS Survey123",
    "aliases": [],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for ArcGIS Survey123: XLSForm authoring, Survey123 Connect, the web designer, the field app, reports and webhooks.",
    "keywords": [
      "survey",
      "xlsform",
      "connect",
      "pulldata",
      "form",
      "report template",
      "webhook"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/survey123/analyze/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Survey123 help",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/survey123/",
          "books": [
            {
              "path": "analyze",
              "tocScript": "/en/survey123/analyze/1883.js"
            },
            {
              "path": "capture/field-app",
              "tocScript": "/en/survey123/capture/field-app/1886.js"
            },
            {
              "path": "capture/main",
              "tocScript": "/en/survey123/capture/main/3719.js"
            },
            {
              "path": "capture/mobile",
              "tocScript": "/en/survey123/capture/mobile/3714.js"
            },
            {
              "path": "capture/web-app",
              "tocScript": "/en/survey123/capture/web-app/1885.js"
            },
            {
              "path": "create/connect",
              "tocScript": "/en/survey123/create/connect/1884.js"
            },
            {
              "path": "create/main",
              "tocScript": "/en/survey123/create/main/3720.js"
            },
            {
              "path": "create/studio",
              "tocScript": "/en/survey123/create/studio/3715.js"
            },
            {
              "path": "create/web-designer",
              "tocScript": "/en/survey123/create/web-designer/1882.js"
            },
            {
              "path": "get-started",
              "tocScript": "/en/survey123/get-started/3396.js"
            }
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 147,
        "probe": {
          "url": "https://doc.arcgis.com/en/survey123/analyze/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [],
    "esearch": {
      "site": "arcgis_doc_col",
      "products": [
        "survey123"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Survey123 help",
        "ref": "https://doc.arcgis.com/en/survey123/analyze/"
      }
    ],
    "pitfalls": [
      "Embedding the web form and the report REST API are documented in the developer product, survey123-dev."
    ],
    "related": [
      "survey123-dev"
    ],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "tracker",
    "name": "ArcGIS Tracker",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "retired",
    "successor": "field-maps",
    "summary": "Retired location tracking app; location sharing is now part of ArcGIS Field Maps.",
    "keywords": [
      "tracker",
      "location tracking",
      "track view"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/tracker/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Retired",
        "current": true,
        "access": "link-only",
        "vars": {}
      }
    ],
    "sources": [],
    "oracles": [],
    "startHere": [
      {
        "title": "ArcGIS Tracker help (retired)",
        "ref": "https://doc.arcgis.com/en/tracker/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "web-editor",
    "name": "ArcGIS Web Editor",
    "aliases": [],
    "category": "product-help",
    "tier": "help",
    "status": "active",
    "summary": "Help for ArcGIS Web Editor: browser-based feature editing with templates, snapping and validation.",
    "keywords": [
      "web editing",
      "edit features",
      "templates",
      "snapping"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/web-editor/latest/create-and-edit/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Web Editor help",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/web-editor/latest/",
          "books": [
            {
              "path": "create-and-edit",
              "tocScript": "/en/web-editor/latest/create-and-edit/3486.js"
            },
            {
              "path": "get-started",
              "tocScript": "/en/web-editor/latest/get-started/3487.js"
            }
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 21,
        "probe": {
          "url": "https://doc.arcgis.com/en/web-editor/latest/create-and-edit/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [],
    "esearch": {
      "site": "arcgis_doc_col",
      "products": [
        "web-editor"
      ],
      "keepUrl": "/latest/"
    },
    "startHere": [
      {
        "title": "ArcGIS Web Editor help",
        "ref": "https://doc.arcgis.com/en/web-editor/latest/create-and-edit/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "workforce",
    "name": "ArcGIS Workforce",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Help for ArcGIS Workforce: creating assignments and coordinating mobile workers.",
    "keywords": [
      "assignment",
      "dispatcher",
      "mobile worker"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/workforce/android-phone/help/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "ArcGIS Workforce help",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/workforce/",
          "books": [
            {
              "path": "android-phone/help",
              "tocScript": "/en/workforce/android-phone/help/2133.js"
            },
            {
              "path": "android-tablet/help",
              "tocScript": "/en/workforce/android-tablet/help/2134.js"
            },
            {
              "path": "faqs",
              "tocScript": "/en/workforce/faqs/2170.js"
            },
            {
              "path": "ipad/help",
              "tocScript": "/en/workforce/ipad/help/2135.js"
            },
            {
              "path": "iphone/help",
              "tocScript": "/en/workforce/iphone/help/2136.js"
            }
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 55,
        "probe": {
          "url": "https://doc.arcgis.com/en/workforce/android-phone/help/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [],
    "esearch": {
      "site": "arcgis_doc_col",
      "products": [
        "workforce-android-phone",
        "workforce-android-tablet",
        "workforce-ipad",
        "workforce-iphone"
      ]
    },
    "startHere": [
      {
        "title": "ArcGIS Workforce help",
        "ref": "https://doc.arcgis.com/en/workforce/android-phone/help/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "microsoft-365",
    "name": "ArcGIS for Microsoft 365",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "retired",
    "statusNote": "Umbrella name only: the help is split into Excel, Power BI, SharePoint and Teams.",
    "summary": "Former umbrella help for the ArcGIS apps for Microsoft 365; the help is now split per app.",
    "keywords": [
      "microsoft 365",
      "office"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/microsoft-365/latest/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Retired",
        "current": true,
        "access": "link-only",
        "vars": {}
      }
    ],
    "sources": [],
    "oracles": [],
    "startHere": [
      {
        "title": "ArcGIS for Microsoft 365 help (retired)",
        "ref": "https://doc.arcgis.com/en/microsoft-365/latest/"
      }
    ],
    "pitfalls": [],
    "related": [
      "arcgis-for-excel",
      "arcgis-for-power-bi",
      "arcgis-for-sharepoint",
      "arcgis-for-teams"
    ],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "community-analyst",
    "name": "ArcGIS Community Analyst",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "retired",
    "successor": "business-analyst",
    "summary": "Retired community data analysis app; replaced by ArcGIS Business Analyst.",
    "keywords": [
      "community analyst",
      "demographics"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/community-analyst/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Retired",
        "current": true,
        "access": "link-only",
        "vars": {}
      }
    ],
    "sources": [],
    "oracles": [],
    "startHere": [
      {
        "title": "ArcGIS Community Analyst help (retired)",
        "ref": "https://doc.arcgis.com/en/community-analyst/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "site-scan",
    "name": "Site Scan for ArcGIS",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "active",
    "summary": "Help for Site Scan for ArcGIS: drone flight planning, fleet management and cloud processing.",
    "keywords": [
      "drone",
      "flight planning",
      "fleet",
      "processing"
    ],
    "languages": [],
    "homepage": "https://doc.arcgis.com/en/site-scan/latest/get-started/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Current",
        "current": true,
        "access": "live",
        "vars": {}
      }
    ],
    "sources": [
      {
        "id": "help",
        "title": "Site Scan for ArcGIS help",
        "kinds": [
          "help"
        ],
        "adapter": "legacy-help",
        "config": {
          "host": "doc.arcgis.com",
          "base": "/en/site-scan/latest/",
          "books": [
            {
              "path": "get-started"
            },
            {
              "path": "process"
            },
            {
              "path": "share-and-export"
            }
          ]
        },
        "capability": "website",
        "floor": true,
        "pagesApprox": 32,
        "probe": {
          "url": "https://doc.arcgis.com/en/site-scan/latest/get-started/flisting.htm",
          "expect": "html",
          "family": "legacy-help",
          "minChars": 200,
          "mustContain": ".htm"
        }
      }
    ],
    "oracles": [],
    "esearch": {
      "site": "arcgis_doc_col",
      "products": [
        "site-scan"
      ],
      "keepUrl": "/latest/"
    },
    "startHere": [
      {
        "title": "Site Scan for ArcGIS help",
        "ref": "https://doc.arcgis.com/en/site-scan/latest/get-started/"
      }
    ],
    "pitfalls": [],
    "related": [
      "site-scan-api"
    ],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "geoanalytics-server",
    "name": "ArcGIS GeoAnalytics Server",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "retired",
    "summary": "Retired ArcGIS Enterprise server role for distributed analysis of big data; its help exists for old versions only.",
    "keywords": [
      "geoanalytics",
      "big data",
      "server role"
    ],
    "languages": [],
    "homepage": "https://enterprise.arcgis.com/en/geoanalytics/11.3/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Retired",
        "current": true,
        "access": "link-only",
        "vars": {}
      }
    ],
    "sources": [],
    "oracles": [],
    "startHere": [
      {
        "title": "ArcGIS GeoAnalytics Server help (retired)",
        "ref": "https://enterprise.arcgis.com/en/geoanalytics/11.3/"
      }
    ],
    "pitfalls": [],
    "related": [
      "geoanalytics-engine"
    ],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  },
  {
    "id": "arcgis-for-inspire",
    "name": "ArcGIS for INSPIRE",
    "aliases": [],
    "category": "product-help",
    "tier": "link",
    "status": "retired",
    "summary": "Retired extension for publishing INSPIRE-compliant services and metadata; its help exists for old versions only.",
    "keywords": [
      "inspire",
      "view service",
      "download service"
    ],
    "languages": [],
    "homepage": "https://enterprise.arcgis.com/en/inspire/10.8/",
    "packages": [],
    "repos": [],
    "lines": [
      {
        "id": "latest",
        "label": "Retired",
        "current": true,
        "access": "link-only",
        "vars": {}
      }
    ],
    "sources": [],
    "oracles": [],
    "startHere": [
      {
        "title": "ArcGIS for INSPIRE help (retired)",
        "ref": "https://enterprise.arcgis.com/en/inspire/10.8/"
      }
    ],
    "pitfalls": [],
    "related": [],
    "licenseTier": "esri-website-terms",
    "verifiedOn": "2026-10-13"
  }
];

/**
 * Help books that belong to developer-tier products, as ready-made sources keyed
 * `product/source`. The data file of that product takes its source from here.
 */
export const helpDeveloperSources: Readonly<Record<string, AnySourceDef>> = {
  "earth-automation-api/api": {
    "id": "api",
    "title": "ArcGIS Earth: automation-api",
    "kinds": [
      "help"
    ],
    "adapter": "legacy-help",
    "config": {
      "host": "doc.arcgis.com",
      "base": "/en/arcgis-earth/",
      "books": [
        {
          "path": "automation-api",
          "tocScript": "/en/arcgis-earth/automation-api/2108.js"
        }
      ]
    },
    "capability": "website",
    "floor": true,
    "pagesApprox": 30,
    "probe": {
      "url": "https://doc.arcgis.com/en/arcgis-earth/automation-api/flisting.htm",
      "expect": "html",
      "family": "legacy-help",
      "minChars": 200,
      "mustContain": ".htm"
    }
  },
  "autocad-api/api": {
    "id": "api",
    "title": "ArcGIS for AutoCAD: commands-api",
    "kinds": [
      "help"
    ],
    "adapter": "legacy-help",
    "config": {
      "host": "doc.arcgis.com",
      "base": "/en/arcgis-for-autocad/latest/",
      "books": [
        {
          "path": "commands-api",
          "tocScript": "/en/arcgis-for-autocad/latest/commands-api/3085.js"
        }
      ]
    },
    "capability": "website",
    "floor": true,
    "pagesApprox": 219,
    "probe": {
      "url": "https://doc.arcgis.com/en/arcgis-for-autocad/latest/commands-api/flisting.htm",
      "expect": "html",
      "family": "legacy-help",
      "minChars": 200,
      "mustContain": ".htm"
    }
  },
  "cityengine/help": {
    "id": "help",
    "title": "ArcGIS CityEngine help",
    "kinds": [
      "help"
    ],
    "adapter": "legacy-help",
    "config": {
      "host": "doc.arcgis.com",
      "base": "/en/cityengine/latest/",
      "books": [
        {
          "path": "cga",
          "tocScript": "/en/cityengine/2026.0/cga/1787.js"
        },
        {
          "path": "get-started",
          "tocScript": "/en/cityengine/2026.0/get-started/1752.js"
        },
        {
          "path": "help",
          "tocScript": "/en/cityengine/2026.0/help/2295.js"
        },
        {
          "path": "install/linux",
          "tocScript": "/en/cityengine/2026.0/install/linux/1400.js"
        },
        {
          "path": "install/windows",
          "tocScript": "/en/cityengine/2026.0/install/windows/1415.js"
        },
        {
          "path": "python",
          "tocScript": "/en/cityengine/2026.0/python/2296.js"
        },
        {
          "path": "tutorials",
          "tocScript": "/en/cityengine/2026.0/tutorials/1161.js"
        },
        {
          "path": "whats-new",
          "tocScript": "/en/cityengine/2026.0/whats-new/2433.js"
        }
      ]
    },
    "capability": "website",
    "floor": true,
    "pagesApprox": 642,
    "probe": {
      "url": "https://doc.arcgis.com/en/cityengine/latest/cga/flisting.htm",
      "expect": "html",
      "family": "legacy-help",
      "minChars": 200,
      "mustContain": ".htm"
    }
  },
  "geoevent-server/help": {
    "id": "help",
    "title": "ArcGIS GeoEvent Server help",
    "kinds": [
      "help"
    ],
    "adapter": "legacy-help",
    "config": {
      "host": "enterprise.arcgis.com",
      "base": "/en/geoevent/latest/",
      "books": [
        {
          "path": "administer",
          "tocScript": "/en/geoevent/12.1/administer/1334.js"
        },
        {
          "path": "analyze",
          "tocScript": "/en/geoevent/12.1/analyze/2577.js"
        },
        {
          "path": "deploy",
          "tocScript": "/en/geoevent/12.1/deploy/2585.js"
        },
        {
          "path": "disseminate-and-notify",
          "tocScript": "/en/geoevent/12.1/disseminate-and-notify/2578.js"
        },
        {
          "path": "geoevent-services",
          "tocScript": "/en/geoevent/12.1/geoevent-services/2579.js"
        },
        {
          "path": "get-started",
          "tocScript": "/en/geoevent/12.1/get-started/1255.js"
        },
        {
          "path": "ingest",
          "tocScript": "/en/geoevent/12.1/ingest/2576.js"
        },
        {
          "path": "reference",
          "tocScript": "/en/geoevent/12.1/reference/2580.js"
        }
      ]
    },
    "capability": "website",
    "floor": true,
    "pagesApprox": 147,
    "probe": {
      "url": "https://enterprise.arcgis.com/en/geoevent/latest/administer/flisting.htm",
      "expect": "html",
      "family": "legacy-help",
      "minChars": 200,
      "mustContain": ".htm"
    }
  },
  "arcpy/legacy": {
    "id": "legacy",
    "title": "ArcGIS Pro (arcpy, tool-reference), earlier versions",
    "kinds": [
      "help"
    ],
    "adapter": "legacy-help",
    "config": {
      "host": "pro.arcgis.com",
      "base": "/en/pro-app/{line}/",
      "books": [
        {
          "path": "arcpy"
        },
        {
          "path": "tool-reference"
        }
      ],
      "lines": [
        "3.6",
        "3.5"
      ],
      "enumerate": "on-demand"
    },
    "capability": "website",
    "lines": [
      "3.6",
      "3.5",
      "3.4",
      "3.3",
      "3.2",
      "3.1",
      "3.0",
      "2.9",
      "2.8",
      "2.7",
      "2.6"
    ],
    "probe": {
      "url": "https://pro.arcgis.com/en/pro-app/3.6/arcpy/flisting.htm",
      "expect": "html",
      "family": "legacy-help",
      "minChars": 200,
      "mustContain": ".htm"
    }
  }
};

/** The retired end-user help of developer-tier tombstones, keyed by product id. */
export const helpDeveloperLinks: Readonly<Record<string, { title: string; ref: string }>> = {
  "appstudio": {
    "title": "ArcGIS AppStudio help (retired)",
    "ref": "https://doc.arcgis.com/en/appstudio/configure-apps/"
  },
  "web-appbuilder": {
    "title": "ArcGIS Web AppBuilder help (retired)",
    "ref": "https://doc.arcgis.com/en/web-appbuilder/latest/create-apps/"
  }
};

/**
 * One row per research entry: the import rule that consumed it and the product or
 * `product/source` it produced or extended.
 */
export const helpImportLedger: ReadonlyArray<{ entry: string; rule: string; target: string }> = [
  {
    "entry": "esri-accessibility",
    "rule": "docesri-product",
    "target": "accessibility"
  },
  {
    "entry": "esri-arcgis-allsource",
    "rule": "docesri-product",
    "target": "arcgis-allsource"
  },
  {
    "entry": "esri-arcgis-autodesk-forma",
    "rule": "docesri-product",
    "target": "arcgis-autodesk-forma"
  },
  {
    "entry": "esri-arcgis-data-interoperability",
    "rule": "docesri-product",
    "target": "arcgis-data-interoperability"
  },
  {
    "entry": "esri-arcgis-data-pipelines",
    "rule": "docesri-product",
    "target": "arcgis-data-pipelines"
  },
  {
    "entry": "esri-arcgis-data-reviewer",
    "rule": "docesri-product",
    "target": "arcgis-data-reviewer"
  },
  {
    "entry": "esri-arcgis-doc-center",
    "rule": "docesri-product",
    "target": "arcgis-doc-center"
  },
  {
    "entry": "esri-arcgis-drone2map",
    "rule": "docesri-product",
    "target": "arcgis-drone2map"
  },
  {
    "entry": "esri-arcgis-enterprise",
    "rule": "docesri-product",
    "target": "arcgis-enterprise"
  },
  {
    "entry": "esri-arcgis-enterprise-cloud-tools",
    "rule": "docesri-product",
    "target": "arcgis-enterprise-cloud-tools"
  },
  {
    "entry": "esri-arcgis-enterprise-k8s",
    "rule": "docesri-product",
    "target": "arcgis-enterprise-k8s"
  },
  {
    "entry": "esri-arcgis-excalibur",
    "rule": "docesri-product",
    "target": "arcgis-excalibur"
  },
  {
    "entry": "esri-arcgis-flight",
    "rule": "docesri-product",
    "target": "arcgis-flight"
  },
  {
    "entry": "esri-arcgis-hub",
    "rule": "docesri-product",
    "target": "arcgis-hub"
  },
  {
    "entry": "esri-arcgis-image-server",
    "rule": "docesri-product",
    "target": "arcgis-image-server"
  },
  {
    "entry": "esri-arcgis-indoors",
    "rule": "docesri-product",
    "target": "arcgis-indoors"
  },
  {
    "entry": "esri-arcgis-knowledge",
    "rule": "docesri-product",
    "target": "arcgis-knowledge"
  },
  {
    "entry": "esri-arcgis-maps-microsoft-fabric",
    "rule": "docesri-product",
    "target": "arcgis-maps-microsoft-fabric"
  },
  {
    "entry": "esri-arcgis-maritime",
    "rule": "docesri-product",
    "target": "arcgis-maritime"
  },
  {
    "entry": "esri-arcgis-mission",
    "rule": "docesri-product",
    "target": "arcgis-mission"
  },
  {
    "entry": "esri-arcgis-monitor",
    "rule": "docesri-product",
    "target": "arcgis-monitor"
  },
  {
    "entry": "esri-arcgis-notebooks",
    "rule": "docesri-product",
    "target": "arcgis-notebooks"
  },
  {
    "entry": "esri-arcgis-pipeline-referencing",
    "rule": "docesri-product",
    "target": "arcgis-pipeline-referencing"
  },
  {
    "entry": "esri-arcgis-pro",
    "rule": "docesri-product",
    "target": "arcgis-pro"
  },
  {
    "entry": "esri-arcgis-quickcapture",
    "rule": "docesri-product",
    "target": "arcgis-quickcapture"
  },
  {
    "entry": "esri-arcgis-reality-server",
    "rule": "docesri-product",
    "target": "arcgis-reality-server"
  },
  {
    "entry": "esri-arcgis-reality-studio",
    "rule": "docesri-product",
    "target": "arcgis-reality-studio"
  },
  {
    "entry": "esri-arcgis-roads-and-highways",
    "rule": "docesri-product",
    "target": "arcgis-roads-and-highways"
  },
  {
    "entry": "esri-arcgis-server",
    "rule": "docesri-product",
    "target": "arcgis-server"
  },
  {
    "entry": "esri-arcgis-storymaps",
    "rule": "docesri-product",
    "target": "arcgis-storymaps"
  },
  {
    "entry": "esri-arcgis-topographic-mapping",
    "rule": "docesri-product",
    "target": "arcgis-topographic-mapping"
  },
  {
    "entry": "esri-arcgis-urban",
    "rule": "docesri-product",
    "target": "arcgis-urban"
  },
  {
    "entry": "esri-arcgis-velocity",
    "rule": "docesri-product",
    "target": "arcgis-velocity"
  },
  {
    "entry": "esri-arcgis-video-server",
    "rule": "docesri-product",
    "target": "arcgis-video-server"
  },
  {
    "entry": "esri-arcgis-workflow-manager",
    "rule": "docesri-product",
    "target": "arcgis-workflow-manager"
  },
  {
    "entry": "esri-deep-learning-studio",
    "rule": "docesri-product",
    "target": "deep-learning-studio"
  },
  {
    "entry": "arcgis-online",
    "rule": "standalone-help",
    "target": "arcgis-online"
  },
  {
    "entry": "doc-3d",
    "rule": "standalone-link",
    "target": "3d-workflows"
  },
  {
    "entry": "doc-arcgis-earth",
    "rule": "standalone-help",
    "target": "arcgis-earth"
  },
  {
    "entry": "doc-arcgis-solutions",
    "rule": "standalone-help",
    "target": "arcgis-solutions"
  },
  {
    "entry": "doc-arcgis-for-autocad",
    "rule": "standalone-help",
    "target": "arcgis-for-autocad"
  },
  {
    "entry": "doc-excel",
    "rule": "standalone-link",
    "target": "arcgis-for-excel"
  },
  {
    "entry": "doc-power-automate",
    "rule": "standalone-link",
    "target": "arcgis-for-power-automate"
  },
  {
    "entry": "doc-power-bi",
    "rule": "standalone-link",
    "target": "arcgis-for-power-bi"
  },
  {
    "entry": "doc-sharepoint",
    "rule": "standalone-link",
    "target": "arcgis-for-sharepoint"
  },
  {
    "entry": "doc-teams",
    "rule": "standalone-link",
    "target": "arcgis-for-teams"
  },
  {
    "entry": "doc-geoplanner",
    "rule": "standalone-link",
    "target": "geoplanner"
  },
  {
    "entry": "doc-ips",
    "rule": "standalone-link",
    "target": "arcgis-ips"
  },
  {
    "entry": "doc-business-analyst",
    "rule": "standalone-help",
    "target": "business-analyst"
  },
  {
    "entry": "doc-collector-classic",
    "rule": "tombstone",
    "target": "collector-classic"
  },
  {
    "entry": "doc-data-appliance",
    "rule": "standalone-link",
    "target": "data-appliance"
  },
  {
    "entry": "doc-esri-demographics",
    "rule": "standalone-link",
    "target": "esri-demographics"
  },
  {
    "entry": "doc-redistricting",
    "rule": "standalone-link",
    "target": "redistricting"
  },
  {
    "entry": "doc-experience-builder",
    "rule": "standalone-help",
    "target": "experience-builder-help"
  },
  {
    "entry": "doc-explorer",
    "rule": "tombstone",
    "target": "explorer"
  },
  {
    "entry": "doc-field-maps",
    "rule": "standalone-help",
    "target": "field-maps"
  },
  {
    "entry": "doc-geobim",
    "rule": "standalone-link",
    "target": "geobim"
  },
  {
    "entry": "doc-imagery",
    "rule": "standalone-link",
    "target": "imagery-workflows"
  },
  {
    "entry": "doc-insights",
    "rule": "tombstone",
    "target": "insights"
  },
  {
    "entry": "doc-instant-apps",
    "rule": "standalone-help",
    "target": "instant-apps"
  },
  {
    "entry": "doc-maps-for-adobecc",
    "rule": "standalone-link",
    "target": "maps-for-adobecc"
  },
  {
    "entry": "doc-microsoft-planetary-computer",
    "rule": "standalone-link",
    "target": "microsoft-planetary-computer"
  },
  {
    "entry": "doc-navigator",
    "rule": "standalone-link",
    "target": "navigator"
  },
  {
    "entry": "doc-dashboards",
    "rule": "standalone-help",
    "target": "dashboards"
  },
  {
    "entry": "doc-pretrained-models",
    "rule": "standalone-link",
    "target": "pretrained-models"
  },
  {
    "entry": "doc-pro-intelligence",
    "rule": "tombstone",
    "target": "pro-intelligence"
  },
  {
    "entry": "doc-streetmap-premium",
    "rule": "standalone-link",
    "target": "streetmap-premium"
  },
  {
    "entry": "doc-survey123",
    "rule": "standalone-help",
    "target": "survey123"
  },
  {
    "entry": "doc-tracker",
    "rule": "tombstone",
    "target": "tracker"
  },
  {
    "entry": "doc-web-editor",
    "rule": "standalone-help",
    "target": "web-editor"
  },
  {
    "entry": "doc-workforce",
    "rule": "standalone-link",
    "target": "workforce"
  },
  {
    "entry": "doc-microsoft-365",
    "rule": "tombstone",
    "target": "microsoft-365"
  },
  {
    "entry": "doc-community-analyst",
    "rule": "tombstone",
    "target": "community-analyst"
  },
  {
    "entry": "doc-site-scan",
    "rule": "standalone-link",
    "target": "site-scan"
  },
  {
    "entry": "ent-legacy-geoanalytics",
    "rule": "tombstone",
    "target": "geoanalytics-server"
  },
  {
    "entry": "ent-legacy-inspire",
    "rule": "tombstone",
    "target": "arcgis-for-inspire"
  },
  {
    "entry": "doc-allsource",
    "rule": "migrated-alias",
    "target": "arcgis-allsource"
  },
  {
    "entry": "doc-appstudio",
    "rule": "developer-tombstone-link",
    "target": "appstudio"
  },
  {
    "entry": "doc-hub",
    "rule": "migrated-alias",
    "target": "arcgis-hub"
  },
  {
    "entry": "doc-indoors",
    "rule": "migrated-alias",
    "target": "arcgis-indoors"
  },
  {
    "entry": "doc-mission",
    "rule": "migrated-alias",
    "target": "arcgis-mission"
  },
  {
    "entry": "doc-monitor",
    "rule": "migrated-alias",
    "target": "arcgis-monitor"
  },
  {
    "entry": "doc-velocity",
    "rule": "saas-twin",
    "target": "arcgis-velocity/saas"
  },
  {
    "entry": "doc-reality-studio",
    "rule": "migrated-alias",
    "target": "arcgis-reality-studio"
  },
  {
    "entry": "doc-cityengine",
    "rule": "developer-books",
    "target": "cityengine/help"
  },
  {
    "entry": "doc-data-pipelines",
    "rule": "saas-twin",
    "target": "arcgis-data-pipelines/saas"
  },
  {
    "entry": "doc-deep-learning-studio",
    "rule": "migrated-alias",
    "target": "deep-learning-studio"
  },
  {
    "entry": "doc-drone2map",
    "rule": "migrated-alias",
    "target": "arcgis-drone2map"
  },
  {
    "entry": "doc-excalibur",
    "rule": "saas-twin",
    "target": "arcgis-excalibur/saas"
  },
  {
    "entry": "doc-urban",
    "rule": "migrated-alias",
    "target": "arcgis-urban"
  },
  {
    "entry": "doc-web-appbuilder",
    "rule": "developer-tombstone-link",
    "target": "web-appbuilder"
  },
  {
    "entry": "doc-quickcapture",
    "rule": "migrated-alias",
    "target": "arcgis-quickcapture"
  },
  {
    "entry": "doc-workflow-manager",
    "rule": "saas-twin",
    "target": "arcgis-workflow-manager/saas"
  },
  {
    "entry": "ent-geoevent",
    "rule": "developer-books",
    "target": "geoevent-server/help"
  },
  {
    "entry": "ent-legacy-portal",
    "rule": "enterprise-legacy-lines",
    "target": "arcgis-enterprise/legacy-portal"
  },
  {
    "entry": "ent-legacy-server",
    "rule": "enterprise-legacy-lines",
    "target": "arcgis-enterprise/legacy-server"
  },
  {
    "entry": "ent-legacy-data-store",
    "rule": "enterprise-legacy-lines",
    "target": "arcgis-enterprise/legacy-data-store"
  },
  {
    "entry": "ent-legacy-web-adaptor",
    "rule": "enterprise-legacy-lines",
    "target": "arcgis-enterprise/legacy-web-adaptor"
  },
  {
    "entry": "ent-legacy-cloud",
    "rule": "enterprise-legacy-lines",
    "target": "arcgis-enterprise/legacy-cloud"
  },
  {
    "entry": "ent-legacy-enterprise",
    "rule": "enterprise-legacy-lines",
    "target": "arcgis-enterprise/legacy-enterprise"
  },
  {
    "entry": "ent-legacy-get-started",
    "rule": "enterprise-legacy-lines",
    "target": "arcgis-enterprise/legacy-get-started"
  },
  {
    "entry": "ent-legacy-system-requirements",
    "rule": "enterprise-legacy-lines",
    "target": "arcgis-enterprise/legacy-system-requirements"
  },
  {
    "entry": "ent-legacy-notebook",
    "rule": "enterprise-legacy-lines",
    "target": "arcgis-enterprise/legacy-notebook"
  },
  {
    "entry": "ent-legacy-image",
    "rule": "enterprise-legacy-lines",
    "target": "arcgis-enterprise/legacy-image"
  },
  {
    "entry": "ent-legacy-knowledge",
    "rule": "enterprise-legacy-lines",
    "target": "arcgis-enterprise/legacy-knowledge"
  },
  {
    "entry": "ent-legacy-video",
    "rule": "migrated-legacy",
    "target": "arcgis-video-server/legacy"
  },
  {
    "entry": "ent-legacy-workflow-manager",
    "rule": "migrated-legacy",
    "target": "arcgis-workflow-manager/legacy"
  },
  {
    "entry": "ent-legacy-data-reviewer",
    "rule": "migrated-legacy",
    "target": "arcgis-data-reviewer/legacy"
  },
  {
    "entry": "ent-legacy-maritime",
    "rule": "migrated-legacy",
    "target": "arcgis-maritime/legacy"
  },
  {
    "entry": "ent-legacy-production-mapping",
    "rule": "migrated-legacy",
    "target": "arcgis-topographic-mapping/legacy"
  },
  {
    "entry": "ent-legacy-roads-highways",
    "rule": "migrated-legacy",
    "target": "arcgis-roads-and-highways/legacy"
  },
  {
    "entry": "ent-legacy-pipeline-referencing",
    "rule": "migrated-legacy",
    "target": "arcgis-pipeline-referencing/legacy"
  },
  {
    "entry": "ent-legacy-monitor",
    "rule": "migrated-legacy",
    "target": "arcgis-monitor/legacy"
  },
  {
    "entry": "legacy-pro-app",
    "rule": "pro-legacy-lines",
    "target": "arcgis-pro/legacy"
  }
];
