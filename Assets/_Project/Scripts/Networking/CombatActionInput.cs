using System;

namespace Nfouz.Networking
{
    /// <summary>
    /// The four approved Sprint 6 combat actions (PlayerCombat.BasicAttack,
    /// TrySpecial, TryDodge, TryClassAbility) as input bits. A player's
    /// device only reports which buttons were pressed; the Photon host runs
    /// the action on its own copy of the match (Host Mode Alpha, see
    /// BattleManager), so a client never applies damage itself.
    /// </summary>
    [Flags]
    public enum CombatAction
    {
        None = 0,
        BasicAttack = 1 << 0,
        Special = 1 << 1,
        Dodge = 1 << 2,
        ClassAbility = 1 << 3,
    }

    /// <summary>
    /// Collects button presses between two network input samples. A tap is
    /// usually shorter than a network tick, so "is the button held right
    /// now?" would miss it; a latch remembers every press until the next
    /// sample takes it. Unity-free, so it is covered by EditMode tests.
    /// </summary>
    public sealed class CombatActionLatch
    {
        /// <summary>This device's latch: the Battle buttons press it,
        /// NetworkInputData.SampleLocal consumes it.</summary>
        public static readonly CombatActionLatch Local = new CombatActionLatch();

        private CombatAction _pending;

        public void Press(CombatAction action)
        {
            _pending |= action;
        }

        /// <summary>Returns every press since the last call, and forgets them.</summary>
        public CombatAction Consume()
        {
            var pressed = _pending;
            _pending = CombatAction.None;
            return pressed;
        }

        public void Clear()
        {
            _pending = CombatAction.None;
        }
    }

    public static class CombatActionBits
    {
        /// <summary>Actions set in this tick's input that were not set in the
        /// previous one: one press runs one action, however many ticks the
        /// same input is repeated for.</summary>
        public static CombatAction NewlyPressed(int currentBits, int previousBits)
        {
            return (CombatAction)(currentBits & ~previousBits) & AllActions;
        }

        /// <summary>Unknown bits from a modified client are dropped.</summary>
        public const CombatAction AllActions =
            CombatAction.BasicAttack | CombatAction.Special | CombatAction.Dodge | CombatAction.ClassAbility;
    }
}
