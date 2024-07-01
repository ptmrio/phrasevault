export const upgrades = [
    { version: 1, upgrade: upgradeToV1 },
];

function upgradeToV1(db) {
    return new Promise((resolve, reject) => {
        // First, attempt to create the schema_version table
        db.run(`
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY
            )
        `, (err) => {
            if (err) {
                reject(err); 
            } else {
                db.run(`
                    ALTER TABLE phrases
                    ADD COLUMN type TEXT DEFAULT 'plain'
                `, (err) => {
                    if (err) {
                        reject(err); 
                    } else {
                        resolve(); 
                    }
                });
            }
        });
    });
}
