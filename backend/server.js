const express = require('express');
const app = express();
app.use(express.json());
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const path = require('path');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
app.use(cors());
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const dbPath = path.join(__dirname, 'todo.db');
let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    await db.exec(`
      CREATE TABLE IF NOT EXISTS todo (
        id TEXT PRIMARY KEY,
        todo TEXT NOT NULL,
        status TEXT NOT NULL
      )
    `);
    await db.exec(` 
      CREATE TABLE IF NOT EXISTS user ( 
      id TEXT PRIMARY KEY, 
      email TEXT NOT NULL, 
      name TEXT NOT NULL, 
      password TEXT NOT NULL 
      ) 
    `);

    app.listen(3000, () => {
      console.log('Server Running at http://localhost:3000/');
    });
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

initializeDBAndServer();

app.post('/signup/', async (request, response) => {
  const { email, password, name } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE name = ?;`;
  const dbUser = await db.get(selectUserQuery, [name]);
  
  if (dbUser === undefined) {
    if (password.length > 6) {
      const hashedPassword = await bcrypt.hash(password, 10);
      const id = uuidv4(); 

      const createUserQuery = `
        INSERT INTO user (id, email, password, name)
        VALUES (?, ?, ?, ?);
      `;
      await db.run(createUserQuery, [id, email, hashedPassword, name]);

      response.status(200).send('User created successfully');
    } else {
      response.status(400).send('Password is too short');
    }
  } else {
    response.status(400).send('User already exists');
  }
});

app.post('/login/', async (request, response) => {
  const {email, password} = request.body
  const selectUserQuery = `
  SELECT *
  FROM user where email="${email}";
  `
  const dbUser = await db.get(selectUserQuery)
  console.log(dbUser)
  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatched === true) {
      const payload = {
        email: email,
        id: dbUser.id,
      }
      const jwtToken = await jwt.sign(payload, 'jehovajireh')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

const authenticateToken = async (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    await jwt.verify(jwtToken, 'jehovajireh', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.email = payload.email
        request.id = payload.id
        next()
      }
    })
  }
}


app.get("/todos/", authenticateToken, async (request, response) => {
  const getTodosQuery = `
  SELECT * FROM todo
  `;
  const getTodo = await db.all(getTodosQuery);
  response.send(getTodo);
});

app.post("/todos/",authenticateToken, async (request, response) => {
  const { todo, status } = request.body;
  const id = uuidv4(); 
  const createTodoQuery = `
  INSERT INTO todo (id, todo, status) VALUES
  ("${id}", "${todo}", "${status}")
  `;
  await db.run(createTodoQuery);
  response.status(201).send("Todo created successfully");
});


app.put('/todos/:todoId/',authenticateToken, async (request, response) => {
  const { todoId } = request.params;

  try {
    const prevTodoQuery = `
    SELECT *
    FROM todo
    WHERE id = ?
    `;
    const prevTodo = await db.get(prevTodoQuery, [todoId]);
   
    const {
      todo = prevTodo.todo,
      status = prevTodo.status,
    } = request.body;

    const getTodoUpdatedColumn = () => {
      if (todo !== prevTodo.todo) {
        return 'Todo';
      } else if (status !== prevTodo.status) {
        return 'Status';
      }
      return "None";
    };

    const updateTodoQuery = `
    UPDATE todo
    SET todo = ?, status = ?
    WHERE id = ?
    `;
    await db.run(updateTodoQuery, [todo, status, todoId]);

    const updatedColumn = getTodoUpdatedColumn();
    if (updatedColumn !== 'None') { 
      const updateTodoQuery = ` 
      UPDATE todo SET todo = ?, 
      status = ? 
      WHERE id = ? `; 
      await db.run(updateTodoQuery, [todo, status, todoId]); 
      response.send(`${updatedColumn} Updated`); 
    } else {
       response.send('No changes detected.'); }
  } catch (error) {
    response.status(500).send('Error updating todo');
  }
});


app.delete('/todos/:todoId/',authenticateToken, async (request, response) => {
  const { todoId } = request.params;
  console.log(todoId);

  try {
    const deleteTodoQuery = `
    DELETE FROM todo
    WHERE id = ?;
    `;
    const result = await db.run(deleteTodoQuery, [todoId]);

    console.log(result)
    if (result.changes > 0) {
      response.send('Todo deleted successfully');
    } else {
      response.status(404).send('Todo not found');
    }
  } catch (error) {
    response.status(500).send('Error deleting todo');
  }
});


app.put('/user/profile', authenticateToken, async (request, response) => {
  const { name, email, password } = request.body;
  const { id } = request;

  try {
  
    let updatedPassword = null;
    if (password) {
      updatedPassword = await bcrypt.hash(password, 10);
    }

  
    const emailQuery = 'SELECT * FROM user WHERE email = ? AND id != ?';
    const existingUser = await db.get(emailQuery, [email, id]);

    if (existingUser) {
      return response.status(400).send('Email is already in use by another user.');
    }


    const updateUserQuery = `
      UPDATE user
      SET name = ?, email = ?, password = ?
      WHERE id = ?
    `;
    
    if (updatedPassword) {
      await db.run(updateUserQuery, [name, email, updatedPassword, id]);
    } else {
      await db.run(updateUserQuery, [name, email, email, id]);
    }

    response.status(200).send('Profile updated successfully');
  } catch (error) {
    console.error(error);
    response.status(500).send('Error updating profile');
  }
});