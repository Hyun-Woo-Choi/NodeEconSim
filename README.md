## Before Starting the Project

- **Node.js**: Version 14.15.3 is recommended.
- **MySQL**: Version 8.0.22 (local installation) is recommended.

### Steps to Set Up the Project

1. **Change the MySQL Root Password**:

   - During MySQL installation, you should have set a username and password. These credentials will be needed for the project.

2. **Execute the SQL Script**:

   - Run the script in [lib/cournot.sql](lib/cournot.sql) from the first line.

3. **Check the Database**:

   - Use the following command to check the database:
     ```sql
     USE cournot;
     ```
   - After confirming the database has been created successfully, execute all scripts in .

4. **Update MySQL Configuration**:

   - Change the password in to match the one you set during MySQL installation.

5. **Update Admin Credentials**:

- If not changed, the default admin credentials in [add_admin.js] are:
  - **ID**: [`admin`]
  - **Password**: [`dia1357`]

6. **Connectinf AWS RDS**:
- you should connect to AWS RDS with password and key, if local you should use connect to local database
- make .env file and add 
MYSQL_HOST=
MYSQL_USER=
MYSQL_PASSWORD=
MYSQL_DATABASE=
