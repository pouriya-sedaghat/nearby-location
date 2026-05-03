db = db.getSiblingDB("nearby");

db.createUser({
  user: "nearby",
  pwd: "nearby_pass_123",
  roles: [
    {
      role: "readWrite",
      db: "nearby",
    },
  ],
});

print('User "nearby" created successfully for database "nearby"');
