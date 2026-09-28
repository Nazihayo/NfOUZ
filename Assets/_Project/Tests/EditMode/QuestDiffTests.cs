using System.Collections.Generic;
using Nfouz.Quests;
using Nfouz.UI;
using NUnit.Framework;

namespace Nfouz.Tests.EditMode
{
    /// <summary>
    /// EditMode tests for NotificationManager's pure QuestDiff helper
    /// (UI/NotificationManager.cs) — Quest updates (newly-completed
    /// detection for the toast notification). Not executed in this
    /// sandbox — see DamageCalculatorTests.cs's header note.
    /// </summary>
    [TestFixture]
    public class QuestDiffTests
    {
        private static QuestData MakeQuest(string id, bool completed) => new QuestData
        {
            player_quest_id = id,
            quest_id = id,
            title = $"Quest {id}",
            is_completed = completed,
        };

        [Test]
        public void FirstEverRefresh_NoPrevious_ReportsNothing()
        {
            var current = new[] { MakeQuest("q1", true) };

            var result = QuestDiff.FindNewlyCompleted(null, current);

            Assert.AreEqual(0, result.Count);
        }

        [Test]
        public void QuestBecomingCompleted_IsReported()
        {
            var previous = new List<QuestData> { MakeQuest("q1", false) };
            var current = new[] { MakeQuest("q1", true) };

            var result = QuestDiff.FindNewlyCompleted(previous, current);

            Assert.AreEqual(1, result.Count);
            Assert.AreEqual("q1", result[0].player_quest_id);
        }

        [Test]
        public void QuestAlreadyCompletedBefore_IsNotReportedAgain()
        {
            var previous = new List<QuestData> { MakeQuest("q1", true) };
            var current = new[] { MakeQuest("q1", true) };

            var result = QuestDiff.FindNewlyCompleted(previous, current);

            Assert.AreEqual(0, result.Count);
        }

        [Test]
        public void IncompleteQuest_IsNeverReported()
        {
            var previous = new List<QuestData> { MakeQuest("q1", false) };
            var current = new[] { MakeQuest("q1", false) };

            var result = QuestDiff.FindNewlyCompleted(previous, current);

            Assert.AreEqual(0, result.Count);
        }

        [Test]
        public void NewQuestNotInPrevious_ButAlreadyCompleted_IsReported()
        {
            // A quest appearing for the first time (e.g. a brand-new daily
            // assignment) that is already completed on first sight still
            // deserves a toast — it wasn't "completed before" because it
            // didn't exist before at all.
            var previous = new List<QuestData> { MakeQuest("q1", false) };
            var current = new[] { MakeQuest("q1", false), MakeQuest("q2", true) };

            var result = QuestDiff.FindNewlyCompleted(previous, current);

            Assert.AreEqual(1, result.Count);
            Assert.AreEqual("q2", result[0].player_quest_id);
        }

        [Test]
        public void MultipleNewlyCompletedQuests_AreAllReported()
        {
            var previous = new List<QuestData> { MakeQuest("q1", false), MakeQuest("q2", false) };
            var current = new[] { MakeQuest("q1", true), MakeQuest("q2", true) };

            var result = QuestDiff.FindNewlyCompleted(previous, current);

            Assert.AreEqual(2, result.Count);
        }
    }
}
