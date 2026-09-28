using Nfouz.UI;
using NUnit.Framework;

namespace Nfouz.Tests.EditMode
{
    /// <summary>
    /// EditMode tests for LoadingManager's pure LoadingCounter class
    /// (UI/LoadingManager.cs) — Screen loading / UI refresh (loading
    /// overlay visibility). No GameObject needed; not executed in this
    /// sandbox — see DamageCalculatorTests.cs's header note.
    /// </summary>
    [TestFixture]
    public class LoadingCounterTests
    {
        [Test]
        public void StartsNotLoading()
        {
            var counter = new LoadingCounter();
            Assert.IsFalse(counter.IsLoading);
        }

        [Test]
        public void Increment_SetsIsLoadingTrue()
        {
            var counter = new LoadingCounter();
            counter.Increment();

            Assert.IsTrue(counter.IsLoading);
        }

        [Test]
        public void Decrement_AfterSingleIncrement_ReturnsToNotLoading()
        {
            var counter = new LoadingCounter();
            counter.Increment();
            counter.Decrement();

            Assert.IsFalse(counter.IsLoading);
        }

        [Test]
        public void OverlappingCallers_StayLoadingUntilAllHaveReleased()
        {
            var counter = new LoadingCounter();
            counter.Increment(); // scene load starts
            counter.Increment(); // an API call starts mid-load

            counter.Decrement(); // scene load finishes
            Assert.IsTrue(counter.IsLoading, "Should still be loading — the API call hasn't released yet.");

            counter.Decrement(); // API call finishes
            Assert.IsFalse(counter.IsLoading);
        }

        [Test]
        public void Decrement_BelowZero_FloorsAtZero_AndDoesNotUnderflow()
        {
            var counter = new LoadingCounter();
            counter.Decrement(); // unmatched decrement — should not go negative
            counter.Increment();

            Assert.IsTrue(counter.IsLoading);
        }
    }
}
