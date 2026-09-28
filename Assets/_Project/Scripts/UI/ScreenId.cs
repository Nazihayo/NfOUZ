namespace Nfouz.UI
{
    /// <summary>
    /// Sprint 10 — Full UI Integration. Identifies every screen UIManager /
    /// BottomNavController know how to show. Split into two groups:
    ///   - Bottom-nav tabs (persistent, one visible at a time, switched via
    ///     BottomNavController): MainMap, Inventory, Friends, Quest, Profile.
    ///   - Pushed screens (shown on top / instead of the current tab, then
    ///     popped back): Battle, Result, Settings, Sos, BattlePass, Shop.
    /// This split is a judgment call documented in the sprint report — the
    /// GDD material handed to this sprint does not specify a nav structure,
    /// so it follows the most common mobile-game convention (persistent
    /// tabs for the "home" loop, pushed screens for everything entered from
    /// a button press that expects a "back"/auto-return).
    /// </summary>
    public enum ScreenId
    {
        // Bottom-nav tabs
        MainMap,
        Inventory,
        Friends,
        Quest,
        Profile,

        // Pushed screens
        Battle,
        Result,
        Settings,
        Sos,
        BattlePass,
        Shop,
    }
}
