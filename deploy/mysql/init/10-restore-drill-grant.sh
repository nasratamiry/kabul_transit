# Runs once, when the MySQL volume is first created (sourced by the mysql image's entrypoint).
# The official image has already loaded the time-zone tables (CONVERT_TZ to Asia/Kabul).
# Lets the app user create and drop the scratch database of `manage.py restore_db --drill`.
docker_process_sql --database=mysql <<SQL
GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}_restore_drill\`.* TO '${MYSQL_USER}'@'%';
FLUSH PRIVILEGES;
SQL
