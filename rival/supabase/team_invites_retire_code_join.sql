-- Run only after the app using request_to_join is live. Until then the
-- live site still joins through this function.
drop function if exists join_league_with_code(text);
