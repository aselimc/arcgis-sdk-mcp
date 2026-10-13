using Desktop.Catalog;
using Desktop.Core;

namespace Snippets.Content
{
  /// <summary>
  /// Invented snippets about project content, written for tests.
  /// </summary>
  public static class ProSnippetsContent
  {
    public static async Task ContentSnippets()
    {
      #region ignore - Variable initialization
      Project project = Project.Current;
      string folder = "/data/polls";
      #endregion

      #region ProSnippet Group: Dialogs
      #endregion

      // cref: Desktop.Catalog.OpenItemDialog
      // cref: Desktop.Catalog.ItemDialog.Title
      #region Show an open dialog
      {
        var dialog = new OpenItemDialog();
        dialog.Title = "Pick a layer file";
        bool? picked = dialog.ShowDialog();
      }
      #endregion // Show an open dialog

      // cref: Desktop.Catalog.SaveItemDialog.ShowDialog
      #region Show a save dialog
      {
        var dialog = new SaveItemDialog { DefaultExt = "lyrx" };
        dialog.ShowDialog();
      }
      #endregion

      #region ProSnippet Group: Project items
      #endregion

      // cref: Desktop.Core.Project.GetItems``1
      // cref: Desktop.Core.Project.AddItem(Desktop.Core.Item)
      #region Add a folder to List<Item>
      await QueuedTask.Run(() =>
      {
        var item = ItemFactory.Instance.Create(folder);
        project.AddItem(item);
      });
      #endregion
    }
  }
}
