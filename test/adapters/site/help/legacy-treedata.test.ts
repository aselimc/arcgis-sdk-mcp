import { describe, expect, it } from 'vitest';
import {
  decodeEntities,
  findTocScripts,
  parseFileListing,
  parseTreedata,
  treePages,
} from '../../../../src/adapters/site/legacy-treedata.js';
import { readFixture } from '../../../support/fixtures.js';

const fixture = (name: string): string => readFixture('cassettes', 'site', 'help', name);

describe('parseTreedata', () => {
  const nodes = parseTreedata(fixture('legacy-4101.js'));

  it('reads every object literal assigned to treedata.data, in file order', () => {
    expect([...nodes.keys()]).toEqual([
      'root',
      '4101_h0',
      '4101_3',
      '4101_9',
      '4101_h1',
      '4101_5',
      '4101_7',
      '4101_6',
      '4101_8',
      '4101_10',
      '4101_11',
      '4101_13',
    ]);
    expect(nodes.get('root')).toEqual({ id: 'root', children: ['4101_h0', '4101_h1'] });
    expect(nodes.get('4101_3')).toEqual({
      id: '4101_3',
      parent: '4101_h0',
      label: 'Get started with the Automation API',
      url: '/en/widget-earth/3.1/automation/get-started.htm',
      children: [],
    });
  });

  it('keeps braces inside labels and decodes entities', () => {
    expect(nodes.get('4101_5')?.label).toBe('Camera {requests}');
    expect(nodes.get('4101_9')?.label).toBe('Release notes & known limits');
  });

  it('skips the alias assignment and a value that is not JSON', () => {
    expect(nodes.has('root_4101')).toBe(false);
    expect(nodes.has('4101_12')).toBe(false);
  });

  it('never evaluates the script', () => {
    const hostile = [
      'treedata.data["a"] = (function () { throw new Error("evaluated"); })();',
      'treedata.data["b"] = { "label": "B", "url": "/b.htm", "children": [1, "c", null] };',
      'treedata.data[\'c\'] = { "label": "quote \\" and } brace", "url": "/c.htm" };',
      'treedata.data["d"] = { "label": "unclosed"',
    ].join('\n');
    const parsed = parseTreedata(hostile);
    expect([...parsed.keys()]).toEqual(['b', 'c']);
    expect(parsed.get('b')?.children).toEqual(['c']);
    expect(parsed.get('c')?.label).toBe('quote " and } brace');
  });

  it('yields nothing for a script of another format', () => {
    expect(parseTreedata('var toc = [{ "title": "A" }];').size).toBe(0);
    expect(parseTreedata('treedata.data["a"] = [1, 2];').size).toBe(0);
    expect(parseTreedata('').size).toBe(0);
  });
});

describe('treePages', () => {
  it('lists topics in reading order with the headings above each', () => {
    const pages = treePages(parseTreedata(fixture('legacy-4101.js')));
    expect(pages.map((page) => [page.title, page.ancestors.join(' / ')])).toEqual([
      ['Get started with the Automation API', 'Overview'],
      ['Release notes & known limits', 'Overview'],
      ['Camera {requests}', 'API reference'],
      // A topic may have topics below it.
      ['Get Camera', 'API reference / Camera {requests}'],
      ['Set Camera', 'API reference'],
      // Named a parent that does not list it: placed after the listed children.
      ['Add Layer', 'API reference'],
      ['Use the desktop app', 'API reference'],
      ['Set Camera (again)', 'API reference'],
      // Its parent does not exist, so it is a root of its own.
      ['Samples', ''],
    ]);
  });

  it('visits a node once, so a cyclic script terminates', () => {
    const cyclic = parseTreedata(
      [
        'treedata.data["a"] = { "label": "A", "url": "/a.htm", "children": ["b"] };',
        'treedata.data["b"] = { "parent": "a", "label": "B", "url": "/b.htm", "children": ["a", "b"] };',
        'treedata.data["x"] = { "parent": "y", "url": "/x.htm", "children": ["y"] };',
        'treedata.data["y"] = { "parent": "x", "label": "Y", "url": "/y.htm" };',
      ].join('\n'),
    );
    // "a" is a root; "x" and "y" only point at each other and follow as a tree of their own.
    expect(treePages(cyclic).map((page) => page.url)).toEqual([
      '/a.htm',
      '/b.htm',
      '/x.htm',
      '/y.htm',
    ]);
    expect(treePages(new Map())).toEqual([]);
  });

  it('gives a topic without a label an empty title and no breadcrumb level', () => {
    const pages = treePages(
      parseTreedata(
        [
          'treedata.data["g"] = { "url": "/g.htm", "children": ["t"] };',
          'treedata.data["t"] = { "parent": "g", "label": "Topic", "url": "/t.htm" };',
        ].join('\n'),
      ),
    );
    expect(pages).toEqual([
      { url: '/g.htm', title: '', ancestors: [] },
      { url: '/t.htm', title: 'Topic', ancestors: [] },
    ]);
  });
});

describe('parseFileListing', () => {
  it('reads the links in order, with markup removed from their text', () => {
    const links = parseFileListing(fixture('legacy-flisting-automation.htm'));
    expect(links.map((link) => link.href)).toEqual([
      'get-started.htm',
      'release-notes.htm',
      'camera.htm',
      'get-camera.htm',
      'set-camera.htm',
      'add-layer.htm',
      'samples.htm',
      'get-started.htm',
      'https://www.example.com/elsewhere.htm',
    ]);
    expect(links[3]).toEqual({ href: 'get-camera.htm', title: 'Get Camera' });
  });

  it('decodes entities and tolerates other quoting and attributes', () => {
    const html =
      '<A class="x" HREF=\'a&amp;b.htm\' title="t">Fish &amp; chips&mdash;menu</A><a name="top">anchor</a><a href="">empty</a>';
    expect(parseFileListing(html)).toEqual([{ href: 'a&b.htm', title: 'Fish & chips—menu' }]);
    expect(parseFileListing('<main>Page not found</main>')).toEqual([]);
  });
});

describe('findTocScripts', () => {
  it('finds the scripts with a numeric file name, once each', () => {
    expect(findTocScripts(fixture('legacy-topic.htm'))).toEqual([
      '/en/widget-earth/3.1/use/4199.js',
      '/en/widget-earth/3.1/get-started/4102.js',
    ]);
    const twice =
      '<script src=\'/en/a/b/12.js\'></script><script defer src="/en/a/b/12.js"></script><script src="/js/app.js"></script>';
    expect(findTocScripts(twice)).toEqual(['/en/a/b/12.js']);
    expect(findTocScripts('<p>no scripts</p>')).toEqual([]);
  });
});

describe('decodeEntities', () => {
  it('decodes named and numeric references and leaves unknown ones as written', () => {
    expect(decodeEntities('A&nbsp;B &#8212; &#x2014; &lt;tag&gt; &quot;q&quot; &apos;')).toBe(
      'A B — — <tag> "q" \'',
    );
    expect(decodeEntities('&unknown; &#0; &#x110000; &AMP;')).toBe('&unknown; &#0; &#x110000; &');
  });
});
