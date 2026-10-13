using Widgets.Mapping;

namespace Widgets.Samples.AddTileLayer
{
    public partial class AddTileLayer
    {
        public AddTileLayer()
        {
            InitializeComponent();
            MyMapView.Map = new Map();
            MyMapView.Map.Layers.Add(new TileLayer(new Uri("https://example.com/tiles")));
        }
    }
}
