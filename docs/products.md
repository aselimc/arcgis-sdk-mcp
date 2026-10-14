# Product coverage

<!-- The tables are a snapshot of the registry (src/registry/data), maintained by hand. Refresh them when products are added. -->

This page lists what the registry contained on 2026-10-13: 136 entries, of which 53 are
current developer products, 7 are tombstones for deprecated or retired developer products,
and 76 are end-user product help.

The server itself is the up-to-date source:

```sh
arcgis-sdk-mcp call list_products                              # developer products by category
arcgis-sdk-mcp call list_products '{"product":"js-maps-sdk"}'  # one profile
arcgis-sdk-mcp call list_products '{"category":"product-help"}'
```

Columns:

- **Lines**: the version lines of the documentation. "link only" means the documentation
  pages of that line are not fetched. For the JavaScript SDK, symbols of other versions are
  read from the TypeScript declarations of the npm package instead.
- **Sources**: the documentation sources of the product. Pass an id as `section` to
  `arcgis_docs_list_products` for its table of contents, or scope a search with
  `product/section` (for example `rest-api/portal`).
- **Lookups**: what the product profile reports. `symbols`: a source indexes symbol records,
  so `arcgis_docs_lookup_symbol` has names to resolve against; `symbols by page title`: it
  matches a name against the titles of API or specification pages instead.
  `samples`: `arcgis_docs_find_samples` has a sample source. `release notes`:
  `arcgis_docs_get_versions` returns release-notes refs. Every product can be searched and
  read.

## Web

| Id                   | Product                                       | Lines                                                           | Sources                                                          | Lookups                         |
| -------------------- | --------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------- |
| `js-maps-sdk`        | ArcGIS Maps SDK for JavaScript                | 5.x; Any other published npm version (typings only) (link only) | `guide`, `samples`, `core`, `components`, `typings`, `templates` | symbols, samples, release notes |
| `calcite`            | Calcite Design System                         | Current                                                         | `guide`, `components`                                            | symbols, release notes          |
| `arcade`             | ArcGIS Arcade                                 | Current                                                         | `guide`, `functions`, `profiles`, `expressions`                  | symbols, samples, release notes |
| `rest-js`            | ArcGIS REST JS                                | Current                                                         | `guide`, `samples`                                               | symbols, samples, release notes |
| `experience-builder` | ArcGIS Experience Builder (developer edition) | Current                                                         | `guide`, `resources`                                             | symbols, samples, release notes |
| `esri-leaflet`       | Esri Leaflet                                  | Current                                                         | `guide`                                                          | symbols                         |
| `maplibre-arcgis`    | MapLibre GL JS with ArcGIS                    | Current                                                         | `guide`                                                          | symbols, release notes          |
| `openlayers-arcgis`  | OpenLayers with ArcGIS                        | Current                                                         | `guide`                                                          |                                 |
| `cesium-arcgis`      | CesiumJS with ArcGIS                          | Current                                                         | `guide`                                                          |                                 |
| `web-map-spec`       | Web map specification                         | Current                                                         | `spec`                                                           | symbols                         |
| `web-scene-spec`     | Web scene specification                       | Current                                                         | `spec`                                                           | symbols                         |

## Native

| Id                 | Product                     | Lines            | Sources                                  | Lookups                         |
| ------------------ | --------------------------- | ---------------- | ---------------------------------------- | ------------------------------- |
| `swift-maps-sdk`   | ArcGIS Maps SDK for Swift   | 300.x; 200.x LTS | `guide`, `api`, `toolkit-api`, `samples` | symbols, samples, release notes |
| `kotlin-maps-sdk`  | ArcGIS Maps SDK for Kotlin  | 300.x; 200.x LTS | `guide`, `api`, `toolkit-api`, `samples` | symbols, samples, release notes |
| `dotnet-maps-sdk`  | ArcGIS Maps SDK for .NET    | 300.x; 200.x LTS | `guide`, `api`, `toolkit-api`, `samples` | symbols, samples, release notes |
| `qt-maps-sdk`      | ArcGIS Maps SDK for Qt      | 300.x; 200.x LTS | `guide`, `samples`                       | symbols, samples, release notes |
| `flutter-maps-sdk` | ArcGIS Maps SDK for Flutter | 300.x; 200.x LTS | `guide`, `api`, `toolkit-api`, `samples` | symbols, samples, release notes |

## Game engines

| Id                | Product                           | Lines | Sources            | Lookups                         |
| ----------------- | --------------------------------- | ----- | ------------------ | ------------------------------- |
| `unity-maps-sdk`  | ArcGIS Maps SDK for Unity         | 2.x   | `guide`, `samples` | symbols, samples, release notes |
| `unreal-maps-sdk` | ArcGIS Maps SDK for Unreal Engine | 2.x   | `guide`, `samples` | symbols, samples, release notes |

## Python, data science and R

| Id                    | Product                                  | Lines                     | Sources                    | Lookups                         |
| --------------------- | ---------------------------------------- | ------------------------- | -------------------------- | ------------------------------- |
| `python-api`          | ArcGIS API for Python                    | 2.4.x; 2.3.x              | `guide`, `api`, `samples`  | symbols, samples, release notes |
| `arcpy`               | ArcPy and geoprocessing tools            | Pro 3.7; Pro 3.6; Pro 3.5 | `arcpy`, `tools`, `legacy` | symbols, release notes          |
| `geoanalytics-engine` | ArcGIS GeoAnalytics Engine               | Current                   | `guide`, `api`, `samples`  | symbols, samples, release notes |
| `geoanalytics-fabric` | ArcGIS GeoAnalytics for Microsoft Fabric | Current                   | `guide`, `api`, `samples`  | symbols, samples, release notes |
| `r-arcgis`            | R-ArcGIS Bridge and arcgis R packages    | Current                   | `guide`, `packages`        | symbols, release notes          |

## Desktop and Enterprise extensibility

| Id                     | Product                     | Lines   | Sources                                     | Lookups                                       |
| ---------------------- | --------------------------- | ------- | ------------------------------------------- | --------------------------------------------- |
| `arcgis-pro-sdk`       | ArcGIS Pro SDK for .NET     | Pro 3.x | `wiki`, `api`, `samples`, `snippets`        | symbols, samples                              |
| `enterprise-sdk`       | ArcGIS Enterprise SDK       | Current | `guide`, `java-api`, `samples`              | symbols, samples, release notes               |
| `cityengine`           | ArcGIS CityEngine           | Current | `help`, `sdk`, `examples`, `pyprt-examples` | symbols by page title, samples, release notes |
| `earth-automation-api` | ArcGIS Earth Automation API | Current | `api`                                       | symbols by page title                         |
| `autocad-api`          | ArcGIS for AutoCAD API      | Current | `api`                                       | symbols by page title                         |

## REST APIs, services and platform

| Id                     | Product                                | Lines   | Sources                                                                                                                                                                                                                                                                                 | Lookups                         |
| ---------------------- | -------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `rest-api`             | ArcGIS REST APIs                       | Current | `services-enterprise`, `portal`, `location-services`, `geocode`, `routing`, `services-online`, `geoenrichment`, `analysis`, `elevation-analysis`, `packaging`, `services-mission`, `admin-enterprise`, `admin-server`, `admin-portal`, `admin-notebook`, `admin-mission`, `admin-video` | symbols, release notes          |
| `developer-guide`      | ArcGIS developer guide                 | Current | `guide`                                                                                                                                                                                                                                                                                 | symbols                         |
| `location-platform`    | ArcGIS Location Platform help          | Current | `help`                                                                                                                                                                                                                                                                                  | release notes                   |
| `hub-dev`              | ArcGIS Hub developer APIs              | Current | `guide`, `api`                                                                                                                                                                                                                                                                          | symbols                         |
| `site-scan-api`        | Site Scan for ArcGIS API               | Current | `api`                                                                                                                                                                                                                                                                                   | symbols                         |
| `urban-api`            | ArcGIS Urban API                       | Current | `guide`                                                                                                                                                                                                                                                                                 | samples, release notes          |
| `workflow-manager-dev` | ArcGIS Workflow Manager developer APIs | Current | `guide`, `samples`                                                                                                                                                                                                                                                                      | symbols, samples, release notes |
| `survey123-dev`        | ArcGIS Survey123 developer resources   | Current | `guide`, `tools`, `webhooks`                                                                                                                                                                                                                                                            | symbols by page title, samples  |
| `velocity-grpc`        | ArcGIS Velocity gRPC feeds (beta)      | Current | `repo`                                                                                                                                                                                                                                                                                  | symbols by page title           |

## AI

| Id          | Product                                 | Lines   | Sources                                                        | Lookups       |
| ----------- | --------------------------------------- | ------- | -------------------------------------------------------------- | ------------- |
| `ai-agents` | AI, agents and MCP across ArcGIS (beta) | Current | `briefs`, `mcp-location-services`, `location-platform-agentic` | release notes |

## Specifications and formats

| Id                            | Product                                            | Lines   | Sources | Lookups               |
| ----------------------------- | -------------------------------------------------- | ------- | ------- | --------------------- |
| `i3s-spec`                    | Indexed 3D Scene Layer (I3S) specification         | Current | `spec`  | symbols by page title |
| `cim-spec`                    | Cartographic Information Model (CIM) specification | Current | `spec`  | symbols               |
| `arcgis-pbf`                  | ArcGIS feature service protocol buffers (PBF)      | Current | `spec`  | symbols by page title |
| `knowledge-pbf`               | ArcGIS Knowledge protocol buffers                  | Current | `spec`  | symbols by page title |
| `lerc`                        | LERC (Limited Error Raster Compression)            | Current | `spec`  | symbols by page title |
| `tile-package-spec`           | Tile package specification (TPKX)                  | Current | `spec`  | symbols by page title |
| `spatially-optimized-parquet` | Spatially optimized Parquet                        | Current | `spec`  | symbols by page title |
| `3d-tiles-esri-crs`           | 3D Tiles layer with Esri coordinate systems        | Current | `spec`  | symbols by page title |
| `projection-engine-db`        | Projection engine database documentation           | Current | `spec`  | symbols by page title |
| `file-geodatabase-api`        | File Geodatabase API                               | Current | `spec`  | symbols by page title |

## DevOps and open source

| Id                  | Product                                 | Lines   | Sources                                                                                                                                                                         | Lookups |
| ------------------- | --------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `enterprise-devops` | ArcGIS Enterprise deployment automation | Current | `cookbook`, `powershell-dsc`, `gitops`, `packer`, `kubernetes`, `observability`                                                                                                 |         |
| `koop`              | Koop                                    | Current | `docs`, `koop`                                                                                                                                                                  |         |
| `developer-support` | Esri developer support samples          | Current | `repo`                                                                                                                                                                          | samples |
| `oss-libraries`     | Esri open-source libraries              | Current | `solution-js`, `hub-js`, `geometry-api-java`, `html-sanitizer`, `wayback-core`, `raster-functions`, `public-transit-tools`, `storymaps-developer-samples`, `field-maps-scripts` | samples |

## Support

| Id           | Product                     | Lines   | Sources    | Lookups |
| ------------ | --------------------------- | ------- | ---------- | ------- |
| `support-kb` | Esri Support knowledge base | Current | `articles` |         |

## Deprecated and retired developer products

These entries exist so that a question about an old product gets a clear answer and a
pointer to its successor. They are hidden from the default list (`include_legacy: true` shows
them) and ranked down in search.

| Id                  | Product                                   | Status     | Successor            |
| ------------------- | ----------------------------------------- | ---------- | -------------------- |
| `java-maps-sdk`     | ArcGIS Maps SDK for Java                  | deprecated | `kotlin-maps-sdk`    |
| `runtime-100`       | ArcGIS Runtime SDKs 100.x                 | retired    | `kotlin-maps-sdk`    |
| `geoevent-server`   | ArcGIS GeoEvent Server                    | deprecated | `arcgis-velocity`    |
| `web-appbuilder`    | ArcGIS Web AppBuilder (Developer Edition) | retired    | `experience-builder` |
| `appstudio`         | ArcGIS AppStudio                          | retired    | none                 |
| `js-api-3x`         | ArcGIS API for JavaScript 3.x             | retired    | `js-maps-sdk`        |
| `arcobjects-arcmap` | ArcObjects SDK and ArcMap                 | retired    | `arcgis-pro-sdk`     |

## Product help

End-user help is category `product-help`: 76 entries, 67 of them current. It is left out of
the default product list: name the product (`"product":"arcgis-pro"`) or pass
`"category":"product-help"`. The entries are generated from
`scripts/data/help-registry.source.json` by `npm run gen`.

**Tier `help` (34 products; the product router can pick these for a call that names no product):** `arcgis-allsource`, `arcgis-data-interoperability`, `arcgis-data-pipelines`, `arcgis-enterprise`, `arcgis-enterprise-cloud-tools`, `arcgis-enterprise-k8s`, `arcgis-hub`, `arcgis-image-server`, `arcgis-indoors`, `arcgis-knowledge`, `arcgis-maps-microsoft-fabric`, `arcgis-mission`, `arcgis-monitor`, `arcgis-notebooks`, `arcgis-pro`, `arcgis-quickcapture`, `arcgis-reality-server`, `arcgis-server`, `arcgis-storymaps`, `arcgis-urban`, `arcgis-velocity`, `arcgis-video-server`, `arcgis-workflow-manager`, `arcgis-online`, `arcgis-earth`, `arcgis-solutions`, `arcgis-for-autocad`, `business-analyst`, `experience-builder-help`, `field-maps`, `instant-apps`, `dashboards`, `survey123`, `web-editor`.

**Tier `link` (33 products; the router never picks these, so a call has to name the product):** `accessibility`, `arcgis-autodesk-forma`, `arcgis-data-reviewer`, `arcgis-doc-center`, `arcgis-drone2map`, `arcgis-excalibur`, `arcgis-flight`, `arcgis-maritime`, `arcgis-pipeline-referencing`, `arcgis-reality-studio`, `arcgis-roads-and-highways`, `arcgis-topographic-mapping`, `deep-learning-studio`, `3d-workflows`, `arcgis-for-excel`, `arcgis-for-power-automate`, `arcgis-for-power-bi`, `arcgis-for-sharepoint`, `arcgis-for-teams`, `geoplanner`, `arcgis-ips`, `data-appliance`, `esri-demographics`, `redistricting`, `geobim`, `imagery-workflows`, `maps-for-adobecc`, `microsoft-planetary-computer`, `navigator`, `pretrained-models`, `streetmap-premium`, `workforce`, `site-scan`.

**Retired (9):** `collector-classic` (use `field-maps`), `explorer` (use `field-maps`), `insights`, `pro-intelligence` (use `arcgis-allsource`), `tracker` (use `field-maps`), `microsoft-365`, `community-analyst` (use `business-analyst`), `geoanalytics-server`, `arcgis-for-inspire`.
