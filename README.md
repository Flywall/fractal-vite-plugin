# Fractal plugin for vite
This package permit to use vite as precompiler for Fractal

## To use it with fractal
1. create vite.config.js :
```
import { defineConfig } from "vite";
import fractal from "fractal-vite-plugin";

export default defineConfig({
    plugins: [
        fractal({
            input: ['src/js/app.js', 'src/css/app.scss'],
            refresh: true
        })
    ]
})
```

2. all files to compile need to be in a './src' foler
3. create a preview file
- For Handlebars engine add this to fractal.config.js:
```
/*
 * Require the Handlebars engine and configure it to work with Vite Js
 */
const handlebars = require('@frctl/handlebars')({
    helpers: {
        uppercase: function (str) {
            return str.toUpperCase();
        },
        vite: function (str) {
            if (fs.existsSync('./public/hot')) {
                if (str.match('/s?css$/') !== "")
                    return '<link href="http://localhost:5173/' + str + '" rel="stylesheet">';
                if (str.match('/js$/') !== "")
                    return '<script src="http://localhost:5173/' + str + '"></script>';
            }
            if (fs.existsSync('./public/build/manifest.json')) {
                let manifest = JSON.parse(fs.readFileSync('./public/build/manifest.json'));
                if (str.match('/css$/') !== "")
                    return '<link href="/build/' + manifest[str].file + '" rel="stylesheet">';
                if (str.match('/js$/') !== "")
                    return '<script src="/build/' + manifest[str].file + '"></script>';
                return;
            }
        },
        viteHotReload: function () {
            return (fs.existsSync('./public/hot')) ? '<script type="module" src="http://localhost:5173/@vite/client"></script>' : '';
        }
    }
})
```
- Handlebars preview file (./components/_preview.hbs)
```
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{{ _config.project.title }}}</title>
    {{{vite 'src/css/app.css' }}}
    {{{vite 'src/js/app.js' }}}
    {{{viteHotReload  }}}
</head>
<body>
    {{{ yield }}}
</body>
</html>
```

## Usage
- To use with files you can use the helper 'vite' and include files that you want
```
{{{vite path/to/file}}}
```

- To add autoreload function when files changes add :
```
{{{viteHotReload }}}
```