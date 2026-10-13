import SwiftUI
import Widgets

struct AddTileLayerView: View {
    var body: some View {
        WidgetMapView(map: WidgetMap(layers: [TileLayer(url: .sampleTiles)]))
    }
}
