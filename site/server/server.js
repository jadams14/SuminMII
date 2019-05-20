var path = require('path')
const express = require('express')
var bodyParser = require('body-parser')
var database = require('./database.js')
const app = express()
var router = express.Router()
const request = require('request')
const jwt = require('jsonwebtoken')
const config = require('./config.js')
var cookieParser = require('cookie-parser')
var fs = require('fs')
var https = require('https')
var imgurUploader = require('imgur-uploader')
var FileReader = require('filereader')

// var certificate = fs.readFileSync('../client-key.pem').toString();
module.exports = {
  connectToServer: connectToServer,
  generateJWT: generateJWT,
  verifyUserViaAlias: verifyUserViaAlias
}
connectToServer()

// ***************** Authentication Middleware **************** //
// This is what every request to the server will have to go through first
// Before it can get through to it's respective request

// Enables REST communication with server.
app.use(bodyParser.urlencoded({
  extended: true
}))
app.set('views', path.join(__dirname, '../models/public'))
app.set('view engine', 'pug')
app.use(express.static(path.join(__dirname, '../public')))
app.use(cookieParser())
app.use(bodyParser.json())
app.use('/', router)
// Used to check current user against the cookie token

async function connectToServer() {
  app.listen(7000, 'localhost', () => {
    console.log('server: Express running → localhost:7000')
  })
}

/// ///////////////////////////////////////////////
// Non page requests.
/// ///////////////////////////////////////////////

router.get('deleteSnippet/:snippetid', (req, res) => {
  let result = database.deleteSnippet(snippetid, req, res, false).then(res => {
    return res[0]
  })
  return result
})

router.get('/logout', (req, res) => {
  res.cookie('currentUser', '')
  res.render('login')
})

router.get('/snippetcontent/:id', (req, res) => {
  console.log('server: Retrieving snippet content with id:', req.params.id)
  database.getSnippetContent(req.params.id).then(response => {
    res.send(JSON.stringify(response[0]))
  })
})

router.post('/forward-snippet/', (req, res) => {
  console.log('server: Forwarding snippet id:', req.body.snippetid)
  database.forwardSnippet(req.body.snippetid).then(res => {
    return res
  })
})

router.post('/create-snippet/', (req, res) => {
  console.log('server: Creating snippet with content:', req.body.content, 'description:', req.body.description, 'redirectid:', req.body.redirectid)
  database.createSnippet(req.body.content, req.body.description, req.body.redirectid).then(res => {
    return res
  })
})

/// ///////////////////////////////////////////////
// Page requests.
/// ///////////////////////////////////////////////
router.get('/index', async function (req, res) {
  var token = new Cookies(req, res).get('currentUser')
  let decoded = jwt.verify(token, config.secret)
  let username = await database.getUserByAlias(decoded.data)
  res.render('index', {
    user: username
  })
})

router.get('/register', function (req, res) {
  res.render('register')
})
router.get('/send', function (req, res) {
  res.render('send')
})

router.get('/stats', function (req, res) {
  res.render('stats')
})

// The next 2 requests include the authentication
// Of the current user
router.get('/', async function (req, res) {
  try {
    let alias = await database.getCurrentUser(req, res).then(res => {
      return res
    })
    verifyUserViaAlias(res, res, alias)
  } catch (e) {
    res.render('login')
  }
})

router.get('/login', async function (req, res) {
  // if (config.loggedOut == true) {
  //   res.render('login')
  // }
  try {
    let alias = await database.getCurrentUser(req, res).then(res => {
      return res
    })
    console.log("alias " + alias)
    verifyUserViaAlias(res, res, alias)
  } catch (e) {
    res.render('login')
  }
})

router.get('/receive', async function (req, res) {
  var clientVariables = {}
  clientVariables.snippetcontents = []
  let alias = await database.getCurrentUser(req, res).then(res => {
    return res
  })
  console.log(alias)
  // Need to load snippet data from the database to display on the page.
  database.getRedirectViaAlias(alias).then(redirect => {
    redirect = redirect[0]
    console.log(redirect)
    var snippets = JSON.parse(redirect.snippetids)
    if (snippets == null || snippets.length == 0) {
      res.render('receive', {
        noSnippetMessage: 'You currently don\'t have any snippets!'
      })
    }
    console.log(snippets)
    // For each snippet, retrieve the snippet content ID.
    snippets.forEach((entry, index) => {
      console.log('1')
      database.getSnippet(entry).then(snippet => {
        snippet = snippet[0]

        // Retrieve the snippet content.
        database.getSnippetContent(snippet.contentid).then(snippetcontent => {
          snippetcontent = snippetcontent[0]

          console.log('server: Rendering receive, snippetcontent.id: ', snippetcontent.id)

          clientVariables.snippetcontents.push({
            'description': snippetcontent.description,
            'content': snippetcontent.content,
            'id': snippetcontent.id,
            'parentid': snippet.id
          })

          // Only return final source if it's final iteration to prevent loss.
          if (index === snippets.length - 1) {
            // Send the created page back to user after loading all the variables,
            // with a slight delay to prevent further problems.
            setTimeout(function () {
              res.render('receive', clientVariables)
            }, 100)
          }
        })
      })
    })
  })
})

router.get('/send', (req, res) => {
  res.render('send')
})

router.get('/stats', (req, res) => {
  res.render('stats')
})

router.post('/send', (req, res) => {
  console.log('Gets Here')
  console.log(req.body.fileupload)
  var reader = new FileReader()
  console.log(reader.readAsDataURL(req.body.fileupload))
  // imgurUploader(fs.readFileSync(res.body.snippetfileinput), {
  //   title: 'Hello!'
  // }).then(data => {
  //   console.log(data);
  // })
  res.render('send')
})

// Login authentication
// Gets the username and password of input and calls authentication function
router.post('/login', async function (req, res) {
  var username = req.body.username
  var password = req.body.password
  if (req.body.button === 'login') {
    if (username === '' || password === '') {
      res.render('login', {
        lMessage: 'Please Enter Username and/or Password!'
      })
    }
    await authenticate(res, req, username, password)
  } else if (req.body.button == 'register') {
    res.redirect('register')
  }
})

router.post('/register', async function (req, res) {
  var username = req.body.username
  var password = req.body.password
  var confirmPassword = req.body.confirmPassword
  if (req.body.button === 'register') {
    if (username === '' || password === '' || confirmPassword === '') {
      res.render('register', {
        rMessage: 'Please Enter Username, Password and/or Confirm Your Password!'
      })
    } else if (password === confirmPassword &&
      (await database.getUserByUsername(username) === false)) {
      database.createUser(username, password)
      res.render('login', {
        lMessage: 'Please Login Using Your New Credentials!'
      })
    }
  } else if (req.body.button == 'cancel') {
    res.redirect('/login')
  }
})

async function verifyUserViaAlias(res, req, alias) {
  var authentication = database.getRedirectViaAlias(alias, false)
  console.log(authentication)
  authentication.then(async function (result) {
    if (result.length > 0) {
      if (
        result[0].alias === alias
      ) {
        let username = await database.getUserByAlias(alias, false).then(res => {
          return res
        })
        res.render('index', {
          user: username
        })
      } else {
        res.render('login')
      }
    } else {
      res.render('login')
    }
  })
}

// Authenticates username and password for login
async function authenticate(res, req, username, password) {
  // let sqlQuery = 'SELECT * FROM Login WHERE username = ?'
  // let sqlData = username
  var authentication = database.getUserData(username, false)
  authentication.then(async function (result) {
    if (result.length > 0) {
      if (
        result[0].username === username &&
        await database.checkPassword(result[0].password, password, result[0].salt)
      ) {
        await generateJWT(res, req, result[0].redirectid, 'currentUser')
        res.render('index', {
          user: username
        })
      } else {
        res.render('login', {
          rMessage: 'Please Enter Username, Password and/or Confirm Your Password!'
        })
      }
    } else {
      res.render('login', {
        rMessage: 'Wrong Username and/or Password!'
      })
    }
  })
}

async function generateJWT(res, req, redirectid, cookieName) {
  var alias = await database.getRedirect(redirectid).then(res => {
    return res[0].alias
  })
  var token = jwt.sign({
    data: alias
  }, config.secret, {
    expiresIn: config.expire
  }, {
    algorithm: 'RS256'
  })
  console.log(res.cookie)
  res.cookie(cookieName, token)
}

app.use('/', router)