using Desktop.Framework;
using Desktop.Mapping;

namespace IdentifyTool
{
    internal class IdentifyTool : MapTool
    {
        protected override Task<bool> OnSketchCompleteAsync(Geometry geometry)
        {
            return QueuedTask.Run(() => ActiveMapView.GetFeatures(geometry).Count > 0);
        }
    }
}
