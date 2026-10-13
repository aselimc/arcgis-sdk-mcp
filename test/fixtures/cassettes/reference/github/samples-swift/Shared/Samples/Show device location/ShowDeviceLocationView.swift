import SwiftUI
import Widgets

struct ShowDeviceLocationView: View {
    @StateObject private var model = Model()

    var body: some View {
        WidgetMapView(map: model.map)
            .task { await model.tracker.start() }
    }
}
