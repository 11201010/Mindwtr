#include <sqlite3.h>

// Swift cannot call SQLite's variadic db_config entry point directly.
int mindwtr_disable_close_checkpoint(sqlite3 *database);
