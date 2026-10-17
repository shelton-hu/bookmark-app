"""Import parsing tests use synthetic files and mocked model requests only."""
import json
import pytest
from backend import importing, services
from backend.importing import parse_file

CONFIG = {'model': 'mock', 'api_key': 'never-print-this', 'base_url': 'https://model.example/v1'}


def encoded(value):
    return json.dumps(value, ensure_ascii=False).encode()


def reply(value):
    return {'choices': [{'message': {'content': json.dumps(value)}}]}


def test_nested_user_tree_preserves_full_urls_empty_folders_and_metadata():
    source = [{'type': 'folder', 'id': 'a', 'title': '收藏', 'children': [
        {'type': 'folder', 'id': 'b', 'title': '研究', 'children': [
            {'type': 'bookmark', 'id': 'c', 'parent_id': 'b',
             'url': 'https://example.org/a?utm_source=x#section', 'title': '阅读',
             'tags': ['工具'], 'notes': '备注', 'description': '简介'}]},
        {'type': 'folder', 'id': 'empty', 'title': '空目录', 'children': []}]}]
    result = parse_file(encoded(source), 'tree.json')
    assert result['method'] == 'local'
    assert result['bookmarks'] == [{'url': 'https://example.org/a?utm_source=x#section',
        'title': '阅读', 'path': ['收藏', '研究'], 'tags': ['工具'], 'notes': '备注', 'description': '简介'}]
    assert ['收藏', '空目录'] in result['folders']
    assert not result['warnings']


def test_own_backup_restores_allowlisted_metadata_without_settings():
    source = {'schema_version': 1,
        'folders': [{'id': 2, 'name': '子', 'parent_id': 1}, {'id': 1, 'name': '根', 'parent_id': None}],
        'bookmarks': [{'url': 'https://example.org', 'title': '标题', 'folder_id': 2,
            'notes': '备注', 'summary': '摘要', 'excerpt': '正文', 'deleted_at': '2026-01-01',
            'manual_classification': True, 'preserve_import_folder': True,
            'classification_status': 'done', 'api_key': 'secret-in-row'}],
        'settings': {'classification': {'api_key': 'secret', 'base_url': 'https://secret.example'}}}
    result = parse_file(encoded(source), 'backup.json', use_model=True)
    item = result['bookmarks'][0]
    assert item['path'] == ['根', '子']
    assert item['summary'] == '摘要' and item['manual_classification'] is True
    assert item['preserve_import_folder'] is True and item['classification_status'] == 'done'
    assert 'secret' not in json.dumps(result)
    assert 'settings' not in result


@pytest.mark.parametrize('folders', [
    [{'id': 1, 'name': 'a', 'parent_id': 1}],
    [{'id': 1, 'name': 'a', 'parent_id': 9}],
    [{'id': 1, 'name': 'a'}, {'id': 1, 'name': 'b'}],
])
def test_invalid_flat_folder_graph(folders):
    with pytest.raises(ValueError, match='目录'):
        parse_file(encoded({'folders': folders, 'bookmarks': []}), 'x.json')


def test_flat_aliases_and_deep_paths():
    result = parse_file(encoded({'folders': [{'id': 'f', 'name': '目录'}], 'bookmarks': [
        {'href': 'https://example.org/one', 'name': '名称', 'folder_id': 'f', 'labels': '一,二'},
        {'网址': 'https://example.org/two', '标题': '二', '文件夹': 'A/B/C/D'}]}), 'x.json')
    assert result['bookmarks'][0]['path'] == ['目录']
    assert result['bookmarks'][0]['tags'] == ['一', '二']
    assert result['bookmarks'][1]['path'] == ['A', 'B', 'C']
    assert any('3 层' in warning for warning in result['warnings'])


def test_chrome_tree_without_parent_ids():
    source = {'roots': {'bookmark_bar': {'type': 'folder', 'id': '1', 'name': '书签栏', 'children': [
        {'type': 'folder', 'id': '2', 'name': '资料', 'children': [
            {'type': 'url', 'id': '3', 'name': '文档', 'url': 'https://example.org/doc'}]}]}}}
    result = parse_file(encoded(source), 'chrome.json')
    assert result['bookmarks'][0]['path'] == ['书签栏', '资料']


def test_netscape_unclosed_dt_and_dd_notes():
    html = '''<!DOCTYPE NETSCAPE-Bookmark-file-1>
<TITLE>Bookmarks</TITLE><DL><p>
<DT><H3>收藏 &amp; 资料</H3><DL><p>
<DT><H3>空目录</H3><DL><p></DL><p>
<DT><A HREF="https://example.org/?a=1&amp;b=2#f" TAGS="参考,工具">标题</A>
<DD>第一段 <b>注释</b>
<DT><A HREF="https://example.org/two">第二条</A>
</DL><p></DL><p>'''
    result = parse_file(html.encode(), 'x.html')
    assert result['bookmarks'][0]['url'] == 'https://example.org/?a=1&b=2#f'
    assert result['bookmarks'][0]['notes'] == '第一段 注释'
    assert result['bookmarks'][0]['path'] == ['收藏 & 资料']
    assert ['收藏 & 资料', '空目录'] in result['folders']
    assert 'notes' not in result['bookmarks'][1]


@pytest.mark.parametrize('encoding', ['utf-8-sig', 'utf-16', 'gb18030'])
def test_csv_encodings_aliases_and_quoted_values(encoding):
    text = '标题,网址,目录,标签,备注\n"资料,一",https://example.org/a,工作/参考,"工具,文档",笔记\n'
    result = parse_file(text.encode(encoding), 'bookmarks.csv')
    assert result['bookmarks'][0]['title'] == '资料,一'
    assert result['bookmarks'][0]['path'] == ['工作', '参考']
    assert result['bookmarks'][0]['tags'] == ['工具', '文档']
    assert result['bookmarks'][0]['notes'] == '笔记'


def test_markdown_heading_paths_and_plain_lists():
    source = '# 工作\n## 文档\n- [阅读](https://example.org/a?x=1#f)\n## 空目录\n# 生活\nhttps://example.org/b\n'
    result = parse_file(source.encode(), 'bookmarks.md')
    assert result['bookmarks'][0]['path'] == ['工作', '文档']
    assert result['bookmarks'][1]['path'] == ['生活']
    assert ['工作', '空目录'] in result['folders']
    plain = parse_file(b'https://example.org/a\nhttps://example.org/b#f\n', 'links.txt')
    assert len(plain['bookmarks']) == 2


@pytest.mark.parametrize('raw,name', [
    (b'{broken}', 'x.json'), (b'null', 'x.json'),
    (b'<DL><A HREF="https://example.org">missing', 'x.html'),
    (b'<html>ordinary page</html>', 'x.html'),
    (b'title,url\n"unclosed,https://example.org', 'x.csv'),
    (b'title,url\na,https://example.org,extra', 'x.csv'),
    (b'foo,bar\na,b', 'x.csv'),
    (b'\x89PNG\r\n\x1a\n', 'image.txt'),
    (b'\x00\x01\x02', 'x.json'), (b'\xff\xfea', 'x.txt'),
    (b'', 'x.json'),
])
def test_corrupt_or_binary_input_fails(raw, name):
    with pytest.raises(ValueError):
        parse_file(raw, name)


def test_invalid_entries_rejected_with_bounded_diagnostics():
    rows = [{'url': 'javascript:alert(1)', 'title': 'unsafe'}] * 120
    rows += [{'url': 'https://user:password@example.org'},
             {'url': 'https://example.org', 'title': 'x' * 1001},
             {'url': 'https://example.org', 'notes': 'x' * 20001},
             {'url': 'https://example.org', 'tags': ['x' * 101]},
             {'url': 'https://example.org', 'tags': ['x'] * 101}]
    result = parse_file(encoded(rows), 'x.json')
    assert not result['bookmarks']
    assert len(result['rejected']) == len(rows)
    assert all(set(item) == {'reason', 'title', 'url'} for item in result['rejected'])
    assert result['warnings']


def test_limits_do_not_silently_truncate():
    with pytest.raises(ValueError, match='10 MB'):
        parse_file(b'a' * (10_000_000 + 1), 'x.txt')
    with pytest.raises(ValueError, match='5000'):
        parse_file(encoded([{'url': 'https://example.org'}] * 5001), 'x.json')
    with pytest.raises(ValueError, match='目录名称'):
        parse_file(encoded([{'type': 'folder', 'title': 'x' * 101, 'children': []}]), 'x.json')


def test_no_model_without_optin_and_metadata_urls_are_not_bookmarks(monkeypatch):
    def forbidden(*args):
        pytest.fail('Model must not be called')
    monkeypatch.setattr(services, 'model_request', forbidden)
    source = {'items': [{'url': 'https://example.org', 'title': 'known', 'favicon_url': 'https://icons.example'}],
              'metadata': {'url': 'https://metadata.example'},
              'unknown': [{'target': 'https://unknown.example', 'caption': 'unknown'}]}
    result = parse_file(encoded(source), 'x.json')
    assert [item['url'] for item in result['bookmarks']] == ['https://example.org']
    assert any('模型' in warning for warning in result['warnings'])
    known = parse_file(encoded({'url': 'https://example.org', 'faviconUrl': 'https://icons.example'}), 'x.json', True, CONFIG)
    assert known['method'] == 'local' and not known['warnings']


def test_unknown_json_mapping_traverses_all_records_without_truncation(monkeypatch):
    rows = [{'target': f'https://example.org/{i}', 'caption': f'标题{i}', 'group': ['工作'], 'keywords': ['资料']}
            for i in range(600)]
    calls = []
    def model(config, endpoint, payload):
        calls.append(payload)
        assert 'untrusted' in payload['messages'][0]['content']
        assert 'never-print-this' not in json.dumps(payload)
        return reply({'mapping': {'url': 'target', 'title': 'caption', 'path': 'group', 'tags': 'keywords'}})
    monkeypatch.setattr(services, 'model_request', model)
    result = parse_file(encoded({'custom': rows}), 'x.json', True, CONFIG)
    assert result['method'] == 'model' and len(result['bookmarks']) == 600
    assert result['bookmarks'][-1]['title'] == '标题599'
    assert result['bookmarks'][-1]['path'] == ['工作']
    assert len(calls) == 1


def test_model_unknown_records_merge_with_known_records(monkeypatch):
    monkeypatch.setattr(services, 'model_request', lambda *args: reply({'mapping': {'url': 'target', 'title': 'caption'}}))
    source = {'items': [{'url': 'https://example.org/known', 'title': '已知'},
                        {'target': 'https://example.org/unknown', 'caption': '未知'}]}
    result = parse_file(encoded(source), 'x.json', True, CONFIG)
    assert result['method'] == 'model'
    assert [item['title'] for item in result['bookmarks']] == ['已知', '未知']


@pytest.mark.parametrize('items,message', [
    ([{'url': 'https://invented.example'}], '不存在'),
    ([{'url': 'https://example.org/1'}], '遗漏'),
    ([{'url': 'https://example.org/1'}, {'url': 'https://example.org/2'}, {'url': 'https://example.org/2'}], '重复'),
    ([{'url': 'https://example.org/1', 'tags': 'x' * 101}, {'url': 'https://example.org/2'}], '限制'),
])
def test_model_extraction_rejects_invented_partial_duplicate_or_invalid_results(monkeypatch, items, message):
    responses = iter([reply({'mapping': None}), reply({'bookmarks': items})])
    monkeypatch.setattr(services, 'model_request', lambda *args: next(responses))
    source = [{'target': 'https://example.org/1'}, {'target': 'https://example.org/2'}]
    with pytest.raises(ValueError, match=message):
        parse_file(encoded(source), 'x.json', True, CONFIG)


def test_model_errors_do_not_echo_secrets(monkeypatch):
    def fail(*args):
        raise RuntimeError('Authorization: Bearer never-print-this https://private-provider.example')
    monkeypatch.setattr(services, 'model_request', fail)
    with pytest.raises(ValueError) as failure:
        parse_file(encoded([{'target': 'https://example.org'}]), 'x.json', True, CONFIG)
    assert '模型' in str(failure.value)
    assert 'never-print-this' not in str(failure.value)
    assert 'private-provider' not in str(failure.value)


def test_model_chunks_preserve_records_and_validate_every_chunk(monkeypatch):
    source = [{'target': f'https://example.org/{i}', 'caption': 'x' * 500} for i in range(150)]
    sizes = []
    def model(config, endpoint, payload):
        data = json.loads(payload['messages'][1]['content'])
        if data['mode'] == 'mapping':
            return reply({'mapping': None})
        sizes.append(len(data['records']))
        return reply({'bookmarks': [{'url': row['target'], 'title': row['caption']} for row in data['records']]})
    monkeypatch.setattr(services, 'model_request', model)
    result = parse_file(encoded(source), 'x.json', True, CONFIG)
    assert len(result['bookmarks']) == 150 and len(sizes) > 1 and sum(sizes) == 150


def test_unknown_json_without_urls_warns_and_does_not_call_model(monkeypatch):
    monkeypatch.setattr(services, 'model_request', lambda *args: pytest.fail('No candidate URLs'))
    result = parse_file(encoded({'mystery': ['value']}), 'x.json', True, CONFIG)
    assert result['warnings'] and not result['bookmarks']


def test_unknown_scalar_url_array_is_explicit_model_only(monkeypatch):
    source = {'custom': ['https://example.org/a', 'https://example.org/b']}
    local = parse_file(encoded(source), 'x.json')
    assert not local['bookmarks'] and any('模型' in warning for warning in local['warnings'])
    monkeypatch.setattr(services, 'model_request', lambda *args: reply({'mapping': {'url': 'value'}}))
    result = parse_file(encoded(source), 'x.json', True, CONFIG)
    assert len(result['bookmarks']) == 2 and result['method'] == 'model'


def test_unknown_nested_mapping_retains_source_ancestry(monkeypatch):
    source = [{'type': 'folder', 'title': '研究', 'children': [
        {'target': 'https://example.org/a', 'caption': '资料', 'keywords': ['原始标签']}]}]
    monkeypatch.setattr(services, 'model_request', lambda *args: reply({'mapping': {'url': 'target', 'title': 'caption', 'tags': 'keywords'}}))
    result = parse_file(encoded(source), 'x.json', True, CONFIG)
    assert result['bookmarks'][0]['path'] == ['研究']
    assert result['bookmarks'][0]['tags'] == ['原始标签']


def test_incidental_description_urls_do_not_trigger_model(monkeypatch):
    monkeypatch.setattr(services, 'model_request', lambda *args: pytest.fail('Incidental URL'))
    source = {'url': 'https://example.org', 'description': 'https://incidental.example',
              'notes': 'https://notes.example', 'title': 'https://title.example'}
    result = parse_file(encoded(source), 'x.json', True, CONFIG)
    assert len(result['bookmarks']) == 1 and not result['warnings']


def test_failed_later_model_chunk_never_returns_partial_result(monkeypatch):
    source = [{'target': f'https://example.org/{i}', 'caption': 'x' * 600} for i in range(100)]
    chunks = []
    def model(config, endpoint, payload):
        data = json.loads(payload['messages'][1]['content'])
        if data['mode'] == 'mapping':
            return reply({'mapping': None})
        chunks.append(data)
        if len(chunks) == 2:
            raise RuntimeError('provider secret')
        return reply({'bookmarks': [{'url': row['target']} for row in data['records']]})
    monkeypatch.setattr(services, 'model_request', model)
    with pytest.raises(ValueError, match='模型解析失败'):
        parse_file(encoded(source), 'x.json', True, CONFIG)
    assert len(chunks) == 2


def test_model_request_budget_checked_before_extraction(monkeypatch):
    source = [{'target': f'https://example.org/{i}', 'caption': 'x' * 1000} for i in range(800)]
    calls = []
    def model(*args):
        calls.append(True)
        return reply({'mapping': None})
    monkeypatch.setattr(services, 'model_request', model)
    with pytest.raises(ValueError, match='32 次'):
        parse_file(encoded(source), 'x.json', True, CONFIG)
    assert len(calls) == 1


@pytest.mark.parametrize('source', [
    {'schema_version': 1, 'folders': [], 'bookmarks': ['invalid']},
    {'schema_version': 1, 'folders': [{'name': 'missing id'}], 'bookmarks': []},
    {'schema_version': 2, 'folders': [], 'bookmarks': []},
])
def test_malformed_backup_fails(source):
    with pytest.raises(ValueError, match='备份'):
        parse_file(encoded(source), 'x.json')


def test_deep_json_is_rejected_without_recursion_leak():
    source = {'url': 'https://example.org'}
    for _ in range(110):
        source = {'children': [source]}
    with pytest.raises(ValueError, match='过深'):
        parse_file(encoded(source), 'x.json')


def test_csv_content_detection_without_extension():
    result = parse_file(b'url,title\nhttps://example.org,Example\n', 'download')
    assert result['format'] == 'CSV' and result['bookmarks'][0]['title'] == 'Example'


@pytest.mark.parametrize('row', [
    {'url': 'https://example .org'},
    {'url': 'https://example.org', 'title': 0},
    {'url': 'https://example.org', 'title': '\ud800'},
    {'url': 'https://example.org', 'tags': [' ']},
    {'url': 'https://example.org', 'path': ['', 'child']},
])
def test_unsafe_scalar_fields_are_rejected(row):
    raw = json.dumps([row]).encode()
    result = parse_file(raw, 'x.json')
    assert not result['bookmarks'] and result['rejected']


def test_unknown_duplicate_records_preserved_in_model_extraction(monkeypatch):
    source = [{'target': 'https://example.org', 'caption': 'first'},
              {'target': 'https://example.org', 'caption': 'second'}]
    responses = iter([reply({'mapping': None}), reply({'bookmarks': [
        {'url': 'https://example.org', 'title': 'first'}, {'url': 'https://example.org', 'title': 'second'}]})])
    monkeypatch.setattr(services, 'model_request', lambda *args: next(responses))
    result = parse_file(encoded(source), 'x.json', True, CONFIG)
    assert [row['title'] for row in result['bookmarks']] == ['first', 'second']


def test_long_original_url_has_bounded_fallback_title():
    url = 'https://example.org/' + 'x' * 1500
    result = parse_file(encoded([{'url': url}]), 'x.json')
    assert result['bookmarks'][0]['url'] == url
    assert len(result['bookmarks'][0]['title']) == 1000


def test_implicit_named_folder_tree_resolves_parent_ids():
    source = {'name': 'root', 'id': 1, 'children': [
        {'name': 'child', 'id': 2, 'children': [
            {'url': 'https://example.org', 'parent_id': 2}]}]}
    result = parse_file(encoded(source), 'x.json')
    assert result['bookmarks'][0]['path'] == ['root', 'child']


def test_explicit_unknown_model_import_requires_configuration():
    with pytest.raises(ValueError, match='配置分类模型'):
        parse_file(encoded({'target': 'https://example.org'}), 'x.json', True)


def test_known_invalid_records_stay_local_after_rejection_display_limit(monkeypatch):
    monkeypatch.setattr(services, 'model_request', lambda *args: pytest.fail('Known invalid records stay local'))
    rows = [{'url': f'https://example.org/{i}', 'title': 'x' * 1001} for i in range(150)]
    result = parse_file(encoded(rows), 'x.json', True, CONFIG)
    assert result['method'] == 'local' and len(result['rejected']) == len(rows)
    assert not result['bookmarks']
