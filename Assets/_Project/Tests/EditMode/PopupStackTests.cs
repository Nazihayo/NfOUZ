using Nfouz.UI;
using NUnit.Framework;

namespace Nfouz.Tests.EditMode
{
    /// <summary>
    /// EditMode tests for PopupManager's pure PopupStack class
    /// (UI/PopupManager.cs) — Popup handling. No GameObject/Canvas needed;
    /// not executed in this sandbox — see DamageCalculatorTests.cs's header
    /// note.
    /// </summary>
    [TestFixture]
    public class PopupStackTests
    {
        private static PopupManager.PopupRequest MakeRequest(string title) =>
            new PopupManager.PopupRequest(title, "message", "OK", null, null, null);

        [Test]
        public void StartsEmpty()
        {
            var stack = new PopupStack();
            Assert.AreEqual(0, stack.Count);
        }

        [Test]
        public void Push_IncrementsCount()
        {
            var stack = new PopupStack();
            stack.Push(MakeRequest("A"));

            Assert.AreEqual(1, stack.Count);
        }

        [Test]
        public void TryPeek_ReturnsMostRecentlyPushed_WithoutRemovingIt()
        {
            var stack = new PopupStack();
            stack.Push(MakeRequest("A"));
            stack.Push(MakeRequest("B"));

            var found = stack.TryPeek(out var top);

            Assert.IsTrue(found);
            Assert.AreEqual("B", top.Value.Title);
            Assert.AreEqual(2, stack.Count); // Peek must not consume
        }

        [Test]
        public void Pop_RemovesAndReturnsMostRecentlyPushed()
        {
            var stack = new PopupStack();
            stack.Push(MakeRequest("A"));
            stack.Push(MakeRequest("B"));

            var popped = stack.Pop();

            Assert.AreEqual("B", popped.Value.Title);
            Assert.AreEqual(1, stack.Count);
        }

        [Test]
        public void Pop_OnEmptyStack_ReturnsNull()
        {
            var stack = new PopupStack();
            var popped = stack.Pop();

            Assert.IsNull(popped);
        }

        [Test]
        public void TryPeek_OnEmptyStack_ReturnsFalse()
        {
            var stack = new PopupStack();
            var found = stack.TryPeek(out var request);

            Assert.IsFalse(found);
            Assert.IsNull(request);
        }
    }
}
