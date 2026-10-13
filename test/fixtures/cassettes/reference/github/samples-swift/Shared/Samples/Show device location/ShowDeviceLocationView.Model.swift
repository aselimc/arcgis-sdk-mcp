import Widgets

extension ShowDeviceLocationView {
    final class Model: ObservableObject {
        let map = WidgetMap(style: .streets)
        let tracker = LocationTracker()
    }
}
