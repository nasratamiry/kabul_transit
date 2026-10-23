-- MySQL time zone data for a Windows server (run once as root):
--   mysql -u root -p < deploy\mysql_timezones_windows.sql
--
-- Why: with USE_TZ=True, Django's date filters/date_hierarchy on MySQL use
-- CONVERT_TZ(..., 'UTC', 'Asia/Kabul'), which returns NULL when MySQL has no
-- time zone tables (the Windows default) and crashes those admin pages.
-- Windows has no system zoneinfo, and mysql_tzinfo_to_sql reads only the old
-- v1 block of the "slim" files in Python's tzdata package (offset 0 = wrong).
--
-- Afghanistan has been UTC+04:30 with no daylight saving since 1945, so a
-- single fixed offset is exact for every date this system stores.
-- On a Linux server use the full database instead:
--   mysql_tzinfo_to_sql /usr/share/zoneinfo | mysql -u root mysql
-- Safe to run more than once.

START TRANSACTION;

-- (MySQL forbids reading and writing system tables in one statement)
SET @has_utc = (SELECT COUNT(*) FROM mysql.time_zone_name WHERE Name = 'UTC');
INSERT INTO mysql.time_zone (Use_leap_seconds) SELECT 'N' FROM DUAL WHERE @has_utc = 0;
SET @utc = IF(ROW_COUNT() > 0, LAST_INSERT_ID(), NULL);
INSERT INTO mysql.time_zone_name (Name, Time_zone_id) SELECT 'UTC', @utc FROM DUAL WHERE @utc IS NOT NULL;
INSERT INTO mysql.time_zone_transition_type (Time_zone_id, Transition_type_id, Offset, Is_DST, Abbreviation)
    SELECT @utc, 0, 0, 0, 'UTC' FROM DUAL WHERE @utc IS NOT NULL;

-- (MySQL forbids reading and writing system tables in one statement)
SET @has_kabul = (SELECT COUNT(*) FROM mysql.time_zone_name WHERE Name = 'Asia/Kabul');
INSERT INTO mysql.time_zone (Use_leap_seconds) SELECT 'N' FROM DUAL WHERE @has_kabul = 0;
SET @kabul = IF(ROW_COUNT() > 0, LAST_INSERT_ID(), NULL);
INSERT INTO mysql.time_zone_name (Name, Time_zone_id) SELECT 'Asia/Kabul', @kabul FROM DUAL WHERE @kabul IS NOT NULL;
INSERT INTO mysql.time_zone_transition_type (Time_zone_id, Transition_type_id, Offset, Is_DST, Abbreviation)
    SELECT @kabul, 0, 16200, 0, '+0430' FROM DUAL WHERE @kabul IS NOT NULL;

COMMIT;
