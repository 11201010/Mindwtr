#include "SQLiteSupport.h"

int mindwtr_disable_close_checkpoint(sqlite3 *database) {
    int disabled = 0;
    int result = sqlite3_db_config(database, SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE, 1, &disabled);
    return result == SQLITE_OK && disabled != 1 ? SQLITE_ERROR : result;
}
