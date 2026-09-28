using System;

namespace Nfouz.Quests
{
    /// <summary>
    /// Sprint 9 — Quest System DTOs. Field names mirror the JSON keys the
    /// backend actually returns (see quest.controller.js) exactly, the same
    /// convention as Social/SocialModels.cs and Inventory/InventoryModels.cs.
    /// </summary>
    [Serializable]
    public class QuestData
    {
        public string player_quest_id;
        public string quest_id;
        public string title;
        public string goal_type; // 'win_battles' | 'distance_traveled' | 'add_friend' | 'use_sos_rescue'
        public int goal_target;
        public int current_progress;
        public bool is_completed;
        public bool is_claimed;
        public int reward_coins;
        public int reward_bp_xp;
        public string expires_at; // ISO 8601 UTC — next UTC midnight
    }

    /// <summary>
    /// GET /quests response. `battle_pass_xp` is included here as a
    /// convenience field (see quest.service.js#getQuests's doc comment for
    /// why) rather than added to an existing "get player" response shape.
    /// </summary>
    [Serializable]
    public class QuestListResponseData
    {
        public QuestData[] quests;
        public int battle_pass_xp;
    }

    [Serializable]
    public class QuestClaimRequest
    {
        public string request_id;
    }

    [Serializable]
    public class QuestClaimResponseData
    {
        public string quest_id;
        public bool already_claimed;
        public int reward_coins;
        public int reward_bp_xp;
        public int battle_pass_xp;
    }
}
