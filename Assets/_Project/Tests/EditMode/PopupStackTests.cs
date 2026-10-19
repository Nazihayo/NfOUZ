using Nfouz.UI;
using NUnit.Framework;

namespace Nfouz.Tests.EditMode
{
    /// <summary>
    /// EditMode tests for PopupManager's pure PopupStack and PopupQueue classes
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

        [Test]
        public void RemoveWhere_RemovesMatches_KeepsOthersInOrder()
        {
            var stack = new PopupStack();
            stack.Push(MakeRequest("A"));
            stack.Push(MakeRequest("X"));
            stack.Push(MakeRequest("B"));

            var removed = stack.RemoveWhere(r => r.Title == "X");

            Assert.AreEqual(1, removed);
            Assert.AreEqual("B", stack.Pop().Value.Title);
            Assert.AreEqual("A", stack.Pop().Value.Title);
        }

        private static PopupManager.PopupRequest Keyed(string title, string key) =>
            new PopupManager.PopupRequest(title, "message", "OK", "Cancel", null, null, key);

        [Test]
        public void Queue_ShowsOnePopupAtATime()
        {
            var queue = new PopupQueue();

            Assert.AreEqual("A", queue.Enqueue(MakeRequest("A")).Value.Title);
            Assert.IsNull(queue.Enqueue(MakeRequest("B"))); // waits behind A
            Assert.AreEqual("A", queue.Current.Value.Title);
            Assert.IsNull(queue.Next()); // A is still on screen
        }

        [Test]
        public void Queue_ButtonsActOnTheVisiblePopup_NotOneQueuedBehindIt()
        {
            var queue = new PopupQueue();
            queue.Enqueue(MakeRequest("A"));
            queue.Enqueue(MakeRequest("B"));

            Assert.AreEqual("A", queue.TakeCurrent().Value.Title);
            Assert.AreEqual("B", queue.Next().Value.Title);
            Assert.AreEqual("B", queue.TakeCurrent().Value.Title);
            Assert.IsNull(queue.Next());
            Assert.AreEqual(0, queue.Count);
        }

        [Test]
        public void Queue_DismissVisibleByKey_FreesTheScreenForTheNext()
        {
            var queue = new PopupQueue();
            queue.Enqueue(Keyed("Invite", "incoming"));
            queue.Enqueue(MakeRequest("B"));

            Assert.IsTrue(queue.Dismiss("incoming"));
            Assert.IsNull(queue.Current);
            Assert.AreEqual("B", queue.Next().Value.Title);
        }

        [Test]
        public void Queue_DismissQueuedByKey_LeavesTheVisiblePopup()
        {
            var queue = new PopupQueue();
            queue.Enqueue(MakeRequest("A"));
            queue.Enqueue(Keyed("Invite", "incoming"));

            Assert.IsFalse(queue.Dismiss("incoming"));
            Assert.AreEqual("A", queue.Current.Value.Title);
            Assert.AreEqual(1, queue.Count);
        }

        [Test]
        public void Queue_DismissUnknownOrEmptyKey_ChangesNothing()
        {
            var queue = new PopupQueue();
            queue.Enqueue(MakeRequest("A")); // no key

            Assert.IsFalse(queue.Dismiss("incoming"));
            Assert.IsFalse(queue.Dismiss(null));
            Assert.IsFalse(queue.Dismiss(""));
            Assert.AreEqual("A", queue.Current.Value.Title);
        }

        [Test]
        public void Queue_TwoIdenticalPopups_AreTakenOneAtATime()
        {
            var queue = new PopupQueue();
            queue.Enqueue(MakeRequest("Same"));
            queue.Enqueue(MakeRequest("Same"));

            queue.TakeCurrent();
            Assert.AreEqual(1, queue.Count);
            Assert.AreEqual("Same", queue.Next().Value.Title);
        }
    }
}
